import { Router, type IRouter, type Request, type Response } from "express";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { requireAuth } from "../middleware/currentUser";
import { redeemFoundingSpot } from "../lib/founding";
import { captureMessage } from "../services/monitoring";
import {
  RC_ENTITLEMENT_ID,
  decideEntitlement,
  shouldRedeemFounding,
  foundingLedgerKey,
  tierForProductId,
  type RevenueCatWebhookBody,
} from "../lib/revenuecat";

const router: IRouter = Router();

type WebhookStage = "receipt_received" | "authorization_checked" | "event_received" | "founding_redemption_committed" | "founding_redemption_failed";

/**
 * Record the webhook's durable processing milestones without sending its
 * authorization header, full receipt, or transaction identifiers to logs/Sentry.
 */
function observeWebhookStage(
  stage: WebhookStage,
  context: Record<string, string | boolean | null | undefined> = {},
  level: "info" | "warning" | "error" = "info",
): void {
  const safeContext = { stage, ...context };
  if (level === "error") {
    logger.error(safeContext, "RevenueCat webhook stage");
  } else if (level === "warning") {
    logger.warn(safeContext, "RevenueCat webhook stage");
  } else {
    logger.info(safeContext, "RevenueCat webhook stage");
  }
  captureMessage("RevenueCat webhook stage", level === "warning" ? "warning" : level, safeContext);
}

/**
 * Founding is a pricing promise, not merely the current product SKU. Preserve it
 * if RevenueCat later reports a standard product, while still allowing a real
 * standard → founding upgrade. The storage layer repeats this protection as an
 * atomic backstop for concurrent entitlement writes.
 */
function tierForWrite(
  storedTier: string | null | undefined,
  incomingTier: "founding" | "standard" | null,
  details: {
    userId: string;
    productIdentifier: string | null | undefined;
    eventType: string;
    source: "webhook" | "sync";
  },
): "founding" | "standard" | null {
  if (storedTier === "founding" && incomingTier === "standard") {
    captureMessage("Blocked attempted founding tier downgrade", "warning", details);
    return null;
  }
  return incomingTier;
}

// POST /iap/sync — reconcile the caller's Squadz+ flag against RevenueCat's
// live subscriber state (REST API). Called after restorePurchases(), after a
// successful purchase, and on launch when client/server entitlement disagree.
// Idempotent: sets or clears is_squadz_plus to match RC exactly.
router.post("/iap/sync", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = (req.user as { id: string }).id;
  const apiKey = process.env.REVENUECAT_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "IAP sync is not configured" });
    return;
  }
  try {
    const rcRes = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    if (!rcRes.ok) {
      logger.error({ status: rcRes.status, userId }, "RevenueCat subscriber lookup failed");
      res.status(502).json({ error: "Could not reach the purchase service" });
      return;
    }
    const body = (await rcRes.json()) as {
      subscriber?: {
        entitlements?: Record<
          string,
          { expires_date?: string | null; product_identifier?: string | null }
        >;
      };
    };
    const ent = body.subscriber?.entitlements?.[RC_ENTITLEMENT_ID];
    const expiresMs = ent?.expires_date != null ? new Date(ent.expires_date).getTime() : null;
    const active = !!ent && (expiresMs === null || expiresMs > Date.now());
    // Tier comes from the entitlement's product identifier. Null when RevenueCat
    // didn't report one (or it isn't one of ours) — `setSquadzPlus` then leaves
    // any previously-known tier untouched rather than erasing it.
    const currentUser = await storage.getUser(userId);
    let incomingTier = active ? tierForProductId(ent?.product_identifier) : null;
    // RevenueCat's direct subscriber read has no transaction identifier, so it
    // cannot atomically claim a founding spot. Until the payment webhook has
    // written founding provenance, a new founding-SKU subscriber reads as
    // standard here; otherwise /iap/sync could recreate the exact sold-out
    // provenance that the webhook correctly rejected.
    if (incomingTier === "founding" && currentUser?.squadzPlusTier !== "founding") {
      incomingTier = "standard";
    }
    const tier = tierForWrite(currentUser?.squadzPlusTier, incomingTier, {
      userId,
      productIdentifier: ent?.product_identifier,
      eventType: "sync",
      source: "sync",
    });
    // Authoritative full-state read from RevenueCat, so this write is
    // unconditional — but it also advances the period marker, otherwise the next
    // webhook would compare against a stale period and could be wrongly dropped.
    const updated = await storage.setSquadzPlus(userId, active, expiresMs, tier);
    // Return the resolved entitlement so the client can adopt it directly after a
    // purchase/restore instead of polling /api/subscription for the webhook to
    // land. Mirrors /api/subscription's contract: tier is 'none' unless entitled,
    // and an entitled user with no observed tier reads as 'standard'.
    const storedTier = updated?.squadzPlusTier ?? tier;
    res.json({
      ok: true,
      isSquadzPlus: active,
      isPro: active,
      tier: active ? (storedTier === "founding" ? "founding" : "standard") : "none",
    });
  } catch (err) {
    logger.error({ err, userId }, "IAP sync failed");
    res.status(500).json({ error: "Failed to sync purchases" });
  }
});

// RevenueCat server-to-server webhook. Mobile IAP (App Store / Play) is the only
// purchase surface, so this is the sole path that flips a user's Squadz+ status
// and consumes founding spots. It runs under express.json() (RevenueCat sends a
// JSON body and authenticates via a shared-secret Authorization header, not an
// HMAC over the raw body).
router.post("/revenuecat/webhook", async (req, res): Promise<void> => {
  // Deliberately only records that an Authorization header was supplied; never
  // include the header value or request body in observability data.
  observeWebhookStage("receipt_received", {
    authorizationPresent: Boolean(req.header("authorization")),
  });
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected) {
    observeWebhookStage("authorization_checked", { authorized: false, reason: "not_configured" }, "error");
    logger.error("REVENUECAT_WEBHOOK_AUTH is not set — rejecting webhook");
    res.status(503).json({ error: "RevenueCat webhook not configured" });
    return;
  }
  if (req.header("authorization") !== expected) {
    observeWebhookStage("authorization_checked", { authorized: false }, "warning");
    logger.warn("RevenueCat webhook auth mismatch");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  observeWebhookStage("authorization_checked", { authorized: true });

  const event = (req.body as RevenueCatWebhookBody | undefined)?.event;
  if (!event || !event.type) {
    res.status(400).json({ error: "Missing event" });
    return;
  }

  // app_user_id is the Squadz user id (set via Purchases.logIn on the client).
  const userId = event.app_user_id || event.original_app_user_id;
  observeWebhookStage("event_received", {
    eventType: event.type,
    periodType: event.period_type ?? null,
    hasAppUserId: Boolean(userId),
  });
  if (!userId) {
    logger.warn({ type: event.type }, "RevenueCat event without app_user_id — acking");
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const decision = decideEntitlement(event);
    let resolvedUser: Awaited<ReturnType<typeof storage.getUser>> | null = null;
    // A paid founding purchase must claim the capped ledger BEFORE its user is
    // written as a founding member. At the final spot, only the ledger winner is
    // founding; a loser was charged by the store's already-open purchase sheet,
    // so they keep SquadZ+ access at the standard tier rather than receiving
    // founding provenance without a spot.
    let foundingRedemption: Awaited<ReturnType<typeof redeemFoundingSpot>> | null = null;
    if (decision === "grant" && shouldRedeemFounding(event)) {
      resolvedUser = await storage.getUser(userId);
      if (!resolvedUser) {
        observeWebhookStage(
          "founding_redemption_failed",
          {
            userId,
            eventType: event.type,
            periodType: event.period_type ?? null,
            reason: "unknown_user",
          },
          "error",
        );
        throw new Error("Founding RevenueCat payment references an unknown user");
      }
      const key = foundingLedgerKey(event);
      if (!key) {
        observeWebhookStage(
          "founding_redemption_failed",
          { userId, eventType: event.type, periodType: event.period_type ?? null },
          "error",
        );
        throw new Error("Founding RevenueCat payment is missing a transaction id");
      }
      try {
        foundingRedemption = await redeemFoundingSpot(key);
        observeWebhookStage("founding_redemption_committed", {
          userId,
          outcome: foundingRedemption,
        });
        if (foundingRedemption === "redeemed") {
          logger.info({ userId }, "Redeemed a founding member spot (RevenueCat)");
        }
      } catch (err) {
        observeWebhookStage(
          "founding_redemption_failed",
          { userId, eventType: event.type, periodType: event.period_type ?? null },
          "error",
        );
        throw err;
      }
    }

    if (decision === "grant" || decision === "revoke") {
      const user = resolvedUser ?? await storage.getUser(userId);
      if (user) {
        // Period-guarded so unordered delivery can't revoke a paid-up user: a
        // delayed EXPIRATION for an old period arriving after its RENEWAL is
        // dropped, because its period is older than the one already applied.
        const periodEndMs =
          typeof event.expiration_at_ms === "number" ? event.expiration_at_ms : null;
        // Only stamp a tier on a grant, and only when the event names one of our
        // products. On a revoke we leave the stored tier alone — access is off
        // via the flag, and readers report tier 'none' while `isSquadzPlus` is
        // false, so the historical tier is preserved without leaking.
        let incomingTier = decision === "grant" ? tierForProductId(event.product_id) : null;
        if (incomingTier === "founding" && foundingRedemption === "sold_out") {
          incomingTier = "standard";
          const details = {
            userId: user.id,
            productIdentifier: event.product_id,
            eventType: event.type,
            source: "webhook" as const,
          };
          captureMessage("Founding purchase arrived after the cohort closed", "warning", details);
          logger.warn(details, "Recorded paid founding SKU as standard after cohort sold out");
        }
        const tier = tierForWrite(user.squadzPlusTier, incomingTier, {
          userId: user.id,
          productIdentifier: event.product_id,
          eventType: event.type,
          source: "webhook",
        });
        const { applied } = await storage.setSquadzPlusForPeriod(
          user.id,
          decision === "grant",
          periodEndMs,
          tier,
        );
        if (applied) {
          logger.info(
            { userId: user.id, type: event.type, decision, periodEndMs },
            "RevenueCat entitlement updated",
          );
        } else {
          logger.info(
            { userId: user.id, type: event.type, decision, periodEndMs },
            "RevenueCat event describes an older period than the one applied — ignoring as stale",
          );
        }
      } else {
        logger.warn({ userId, type: event.type }, "RevenueCat event for unknown user — acking");
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error(
      { err, type: event.type, userId },
      "RevenueCat webhook failed — returning 500 so RevenueCat retries",
    );
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

export default router;
