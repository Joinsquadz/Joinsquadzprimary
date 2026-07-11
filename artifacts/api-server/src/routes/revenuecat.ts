import { Router, type IRouter } from "express";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { redeemFoundingSpot } from "../lib/founding";
import {
  decideEntitlement,
  shouldRedeemFounding,
  foundingLedgerKey,
  type RevenueCatWebhookBody,
} from "../lib/revenuecat";

const router: IRouter = Router();

// RevenueCat server-to-server webhook. Mobile IAP (App Store / Play) is the only
// purchase surface, so this is the sole path that flips a user's Squadz+ status
// and consumes founding spots. It runs under express.json() (RevenueCat sends a
// JSON body and authenticates via a shared-secret Authorization header, not an
// HMAC over the raw body).
router.post("/revenuecat/webhook", async (req, res): Promise<void> => {
  const expected = process.env.REVENUECAT_WEBHOOK_AUTH;
  if (!expected) {
    logger.error("REVENUECAT_WEBHOOK_AUTH is not set — rejecting webhook");
    res.status(503).json({ error: "RevenueCat webhook not configured" });
    return;
  }
  if (req.header("authorization") !== expected) {
    logger.warn("RevenueCat webhook auth mismatch");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const event = (req.body as RevenueCatWebhookBody | undefined)?.event;
  if (!event || !event.type) {
    res.status(400).json({ error: "Missing event" });
    return;
  }

  // app_user_id is the Squadz user id (set via Purchases.logIn on the client).
  const userId = event.app_user_id || event.original_app_user_id;
  if (!userId) {
    logger.warn({ type: event.type }, "RevenueCat event without app_user_id — acking");
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const decision = decideEntitlement(event);
    if (decision === "grant" || decision === "revoke") {
      const user = await storage.getUser(userId);
      if (user) {
        await storage.setSquadzPlus(user.id, decision === "grant");
        logger.info(
          { userId: user.id, type: event.type, decision },
          "RevenueCat entitlement updated",
        );
      } else {
        logger.warn({ userId, type: event.type }, "RevenueCat event for unknown user — acking");
      }
    }

    // Consume a Founding Member spot ONLY on a confirmed payment for the founding
    // product. Idempotent per original_transaction_id via the shared ledger, so
    // re-delivery / annual renewals can't double-count. On failure we rethrow →
    // 500 → RevenueCat retries; idempotency makes the retry safe, and without it a
    // paid founding purchase could silently lose its spot forever.
    if (shouldRedeemFounding(event)) {
      const key = foundingLedgerKey(event);
      if (key) {
        const consumed = await redeemFoundingSpot(key);
        if (consumed) logger.info({ userId, key }, "Redeemed a founding member spot (RevenueCat)");
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
