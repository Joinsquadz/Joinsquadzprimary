// RevenueCat product / entitlement constants and pure event-mapping helpers.
//
// These constants MUST match the RevenueCat dashboard AND the mobile client
// (artifacts/squadz-native/lib/revenuecat.ts). RevenueCat is the source of truth
// for entitlements; the server only mirrors the resulting state into the unified
// `users.is_squadz_plus` flag (via the webhook) and consumes founding spots.

export const RC_ENTITLEMENT_ID = "squadz_plus";
export const RC_FOUNDING_PRODUCT_ID = "squadz_plus_founding_yearly";
export const RC_STANDARD_PRODUCT_ID = "squadz_plus_standard_yearly";

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
  return (
    event.product_id === RC_FOUNDING_PRODUCT_ID ||
    event.product_id === RC_STANDARD_PRODUCT_ID
  );
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
  if (REVOKE_TYPES.has(event.type)) return "revoke";

  const expired =
    typeof event.expiration_at_ms === "number" && event.expiration_at_ms <= nowMs;

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
  if (event.product_id !== RC_FOUNDING_PRODUCT_ID) return false;
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
