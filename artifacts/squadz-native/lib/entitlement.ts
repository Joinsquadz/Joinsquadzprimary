/**
 * Squadz+ entitlement model.
 *
 * One store, one shape. Before this existed, several screens each fetched their
 * own copy of "is this user Pro?", so a completed purchase updated whichever
 * screen happened to be mounted and left the rest stale until an app restart.
 * AppContext owns the state; this module owns the *types and precedence rules*
 * and is deliberately free of React and react-native imports so the logic can be
 * unit-tested under plain node.
 */

/** Price tier of an ACTIVE entitlement. 'none' whenever `entitled` is false. */
export type EntitlementTier = "founding" | "standard" | "none";

/**
 * Where an entitlement reading came from. This is what makes precedence
 * decidable: a local RevenueCat "yes" outranks a server "no", because the store
 * has already taken the user's money and the server is merely waiting on a
 * webhook. See `applyEntitlement`.
 */
export type EntitlementSource =
  /** Read from the RevenueCat SDK on this device (purchase, restore, listener). */
  | "revenuecat"
  /** Read from our API (`/api/subscription` or `/api/iap/sync`). */
  | "server"
  /** Assumed immediately after a successful purchase, pending server confirmation. */
  | "optimistic";

export type ResolvedEntitlement = {
  resolved: true;
  entitled: boolean;
  tier: EntitlementTier;
  source: EntitlementSource;
};

/** Nothing has reported yet — NOT the same as "free". Gated UI shows a spinner. */
export type UnresolvedEntitlement = { resolved: false; entitled: false; tier: "none" };

export type Entitlement = ResolvedEntitlement | UnresolvedEntitlement;

export const UNRESOLVED_ENTITLEMENT: UnresolvedEntitlement = {
  resolved: false,
  entitled: false,
  tier: "none",
};

/**
 * Decide whether an incoming reading should replace the current one.
 *
 * The rule that matters: a NEGATIVE reading from the server must not clobber a
 * POSITIVE reading that came from the store on this device. After a purchase the
 * RevenueCat webhook can take a few seconds, so `/api/subscription` legitimately
 * answers "not Pro" for a user who just paid — adopting that would re-lock the
 * app underneath them. The reverse is fine: server "yes" always wins, and a
 * store-sourced "no" (expiry, refund, restore-found-nothing) always wins, because
 * the store is authoritative about the absence of a purchase.
 */
export function applyEntitlement(
  current: Entitlement,
  next: ResolvedEntitlement,
): ResolvedEntitlement {
  // First reading of the session always lands.
  if (!current.resolved) return next;
  // Any positive reading is adopted, and any negative reading sourced from the
  // store/device is adopted (the store knows when a purchase is really gone).
  if (next.entitled || next.source !== "server") return next;
  // Remaining case: server says "not entitled". Only honour it if the current
  // reading isn't a device-confirmed entitlement still awaiting the webhook.
  const localPositivePending =
    current.entitled && (current.source === "revenuecat" || current.source === "optimistic");
  return localPositivePending ? current : next;
}
