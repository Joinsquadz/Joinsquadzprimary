// RevenueCat product / entitlement constants and pure event-mapping helpers.
//
// These constants MUST match the RevenueCat dashboard AND the mobile client
// (artifacts/squadz-native/lib/revenuecat.ts). RevenueCat is the source of truth
// for entitlements; the server only mirrors the resulting state into the unified
// `users.is_squadz_plus` flag (via the webhook) and consumes founding spots.

export const RC_ENTITLEMENT_ID = "squadz_plus";
// The REAL store product identifiers, registered in App Store Connect, Google
// Play and the RevenueCat dashboard. These are shared across both platforms.
//
// History: this file (and the mobile client) previously carried invented ids
// (`squadz_plus_founding_yearly` / `squadz_plus_standard_yearly`) that matched
// NEITHER store, so every real purchase fell through to the
// "entitled but unrecognized product" fallback and silently lost its founding
// provenance. Never edit these without changing the stores to match.
export const RC_FOUNDING_PRODUCT_ID = "com.squadz.app.squadzplus.founding.annual";
export const RC_STANDARD_PRODUCT_ID = "com.squadz.app.squadzplus.standard.annual";
// Google Play product ids cannot safely be renamed after release. RevenueCat
// may report either these legacy Play ids or the newer App Store-style ids.
export const RC_LEGACY_FOUNDING_PRODUCT_ID = "squadz_plus_founding_yearly";
export const RC_LEGACY_STANDARD_PRODUCT_ID = "squadz_plus_standard_yearly";

/** Which price tier a Squadz+ entitlement was purchased at. */
export type SquadzPlusTier = "founding" | "standard";

/**
 * Normalize a store product identifier to its bare product id.
 *
 * Google Play reports a subscription product as `"{subscriptionId}:{basePlanId}"`
 * while the App Store reports the bare product id. Comparing only the part
 * before the first ":" matches both forms with one rule (an App Store id has no
 * colon, so the whole string is used). Same normalization as the mobile client.
 */
export function baseProductId(productId: string | null | undefined): string | null {
  if (!productId) return null;
  const base = productId.split(":")[0];
  return base || null;
}

/**
 * Map a store product identifier to its Squadz+ tier, or null when the id isn't
 * one of ours (or is absent — several webhook event types omit product_id).
 */
export function tierForProductId(
  productId: string | null | undefined,
): SquadzPlusTier | null {
  const base = baseProductId(productId);
  if (base === RC_FOUNDING_PRODUCT_ID || base === RC_LEGACY_FOUNDING_PRODUCT_ID) return "founding";
  if (base === RC_STANDARD_PRODUCT_ID || base === RC_LEGACY_STANDARD_PRODUCT_ID) return "standard";
  return null;
}

/** Is this one of our Squadz+ products (in either bare or Play base-plan form)? */
export function isKnownSquadzPlusProduct(productId: string | null | undefined): boolean {
  return tierForProductId(productId) !== null;
}

export interface RevenueCatEvent {
  type: string;
  app_user_id?: string | null;
  original_app_user_id?: string | null;
  product_id?: string | null;
  entitlement_ids?: string[] | null;
  entitlement_id?: string | null;
  period_type?: string | null; // NORMAL | TRIAL | INTRO | PROMOTIONAL
  expiration_at_ms?: number | null;
  original_transaction_id?: string | null;
  transaction_id?: string | null;
  store?: string | null;
}

export interface RevenueCatWebhookBody {
  event?: RevenueCatEvent;
  api_version?: string;
}

/** Does this event concern the Squadz+ entitlement / one of our products? */
export function eventTargetsSquadzPlus(event: RevenueCatEvent): boolean {
  const ids = event.entitlement_ids ?? (event.entitlement_id ? [event.entitlement_id] : []);
  if (ids && ids.includes(RC_ENTITLEMENT_ID)) return true;
  // Some event types omit entitlement ids — fall back to our known product ids.
  // Normalized, so a Google Play `"{productId}:{basePlanId}"` still matches.
  return isKnownSquadzPlusProduct(event.product_id);
}

export type EntitlementDecision = "grant" | "revoke" | "ignore";

// Events that mean the entitlement is (now) active.
const GRANT_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
]);
// Events that mean the entitlement has ended.
const REVOKE_TYPES = new Set(["EXPIRATION"]);

/**
 * Decide the resulting entitlement state for an event.
 *
 * - CANCELLATION means auto-renew was turned off but access continues until
 *   expiration → no change (we wait for EXPIRATION to revoke).
 * - BILLING_ISSUE is a grace-period warning; access usually continues → no change.
 * - TRANSFER moves the entitlement between app_user_ids; we grant for the id in
 *   the event when still active, else revoke.
 * - A grant event whose expiration has already passed (delayed delivery) revokes.
 */
export function decideEntitlement(event: RevenueCatEvent, nowMs = Date.now()): EntitlementDecision {
  if (!eventTargetsSquadzPlus(event)) return "ignore";

  const expired =
    typeof event.expiration_at_ms === "number" && event.expiration_at_ms <= nowMs;

  if (REVOKE_TYPES.has(event.type)) {
    // An EXPIRATION whose own expiry is still in the FUTURE has been superseded
    // (renewal / resubscribe / extension), so acting on it would revoke a
    // subscriber who is currently paid up.
    //
    // NOTE: this alone does NOT make delivery-order safe. The common bad case is
    // an EXPIRATION for an OLD period (its timestamp already in the past)
    // arriving AFTER the renewal that replaced it — that looks identical to a
    // legitimate expiry here. `reconcileEntitlement` handles it by comparing
    // against the period we last applied; this function is period-agnostic.
    if (typeof event.expiration_at_ms === "number" && !expired) return "ignore";
    return "revoke";
  }

  if (GRANT_TYPES.has(event.type)) return expired ? "revoke" : "grant";
  if (event.type === "TRANSFER") return expired ? "revoke" : "grant";

  return "ignore";
}

/**
 * Should this event consume a Founding Member spot?
 *
 * Only a REAL, PAID purchase of the founding product. Trials / intro / promo
 * periods (period_type != NORMAL) are not payments. Renewals are allowed through
 * because the founding ledger is keyed by original_transaction_id, so the spot is
 * consumed exactly once (first paid period) and every later renewal is a harmless
 * idempotent no-op. Standard-tier purchases never consume a founding spot.
 */
export function shouldRedeemFounding(event: RevenueCatEvent): boolean {
  // Normalized comparison: on Google Play the event's product_id arrives as
  // `"{productId}:{basePlanId}"`, so an exact match would never fire and an
  // Android founding purchase would never consume its spot.
  if (tierForProductId(event.product_id) !== "founding") return false;
  if (event.period_type && event.period_type !== "NORMAL") return false;
  return (
    event.type === "INITIAL_PURCHASE" ||
    event.type === "RENEWAL" ||
    event.type === "NON_RENEWING_PURCHASE"
  );
}

/**
 * Stable idempotency anchor for the shared founding ledger (text PK). Prefixed
 * with `rc:` so a RevenueCat transaction id can never collide with a Stripe
 * subscription id in the same table.
 */
export function foundingLedgerKey(event: RevenueCatEvent): string | null {
  const id = event.original_transaction_id || event.transaction_id;
  return id ? `rc:${id}` : null;
}
