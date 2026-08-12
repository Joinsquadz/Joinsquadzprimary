import { Platform } from "react-native";

// RevenueCat product / entitlement identifiers. MUST match the RevenueCat
// dashboard AND the server (artifacts/api-server/src/lib/revenuecat.ts).
export const RC_ENTITLEMENT_ID = "squadz_plus";
// The REAL store product identifiers, registered in App Store Connect, Google
// Play and the RevenueCat dashboard. Shared across both platforms.
//
// History: these constants previously held invented ids
// (`squadz_plus_founding_yearly` / `squadz_plus_standard_yearly`) that matched
// NEITHER store, so every real purchase resolved through the
// "entitled but unrecognized product" fallback and lost founding provenance.
// Never edit these without changing the stores to match.
export const RC_FOUNDING_PRODUCT_ID = "com.squadz.app.squadzplus.founding.annual";
export const RC_STANDARD_PRODUCT_ID = "com.squadz.app.squadzplus.standard.annual";

type PurchasesModule = typeof import("react-native-purchases");
type PurchasesDefault = PurchasesModule["default"];

/**
 * Whether a RevenueCat StoreProduct identifier corresponds to one of our
 * product ids.
 *
 * The store identifier format differs by platform:
 * - iOS (App Store): the identifier IS the product id, e.g.
 *   `"squadz_plus_founding_yearly"`.
 * - Android (Google Play): a subscription's identifier is
 *   `"{subscriptionId}:{basePlanId}"`, e.g.
 *   `"squadz_plus_founding_yearly:founding-yearly"`.
 *
 * A naive `identifier === targetId` check therefore matches on iOS but NEVER
 * matches the founding (or standard) package on Android, silently dropping the
 * user to the fallback package. Comparing the base subscription id — the part
 * before the first `":"` — matches correctly on both platforms (iOS has no
 * colon, so the whole string is used).
 */
export function productMatches(identifier: string | null | undefined, targetId: string): boolean {
  if (!identifier) return false;
  return identifier.split(":")[0] === targetId;
}

let _purchases: PurchasesDefault | null = null;
let _configured = false;
// Tracks the in-flight configure/logIn kicked off by the RevenueCat connector on
// login, so purchase/restore/price calls can await it and avoid a startup race
// (a fast tap before the SDK has finished identifying the user).
let _configurePromise: Promise<void> | null = null;

async function ensureConfigured(): Promise<void> {
  if (_configurePromise) {
    try {
      await _configurePromise;
    } catch {
      // Configuration errors are swallowed at their source; nothing to do here.
    }
  }
}

// Public SDK API keys are safe to ship in the client. Mobile IAP (App Store /
// Play) is the ONLY purchase surface, so there is no web key — on web every
// purchase path is a no-op that tells the user to use the mobile app.
function apiKey(): string | null {
  if (Platform.OS === "ios") return process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? null;
  if (Platform.OS === "android") return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? null;
  return null;
}

// Lazy, guarded import so the native module never crashes web bundling / preview.
async function getPurchases(): Promise<PurchasesDefault | null> {
  if (Platform.OS === "web") return null;
  if (_purchases) return _purchases;
  try {
    const mod = await import("react-native-purchases");
    _purchases = mod.default;
    return _purchases;
  } catch {
    return null;
  }
}

/**
 * Configure RevenueCat and identify the current user (app_user_id = SquadZ user
 * id). Idempotent: safe to call on every login. No-op on web or when the SDK key
 * isn't set (graceful degrade — the app still runs, purchases just aren't
 * available on that surface).
 */
export async function configureRevenueCat(appUserId: string): Promise<void> {
  const key = apiKey();
  if (!key || !appUserId) return;
  const promise = (async () => {
    const Purchases = await getPurchases();
    if (!Purchases) return;
    try {
      if (!_configured) {
        Purchases.configure({ apiKey: key, appUserID: appUserId });
        _configured = true;
      } else {
        await Purchases.logIn(appUserId);
      }
    } catch {
      // Preview mode / misconfiguration — never crash the app over billing setup.
    }
  })();
  _configurePromise = promise;
  await promise;
}

/** Detach the current user from RevenueCat on logout. No-op if never configured. */
export async function logOutRevenueCat(): Promise<void> {
  if (!_configured) return;
  const Purchases = await getPurchases();
  if (!Purchases) return;
  try {
    await Purchases.logOut();
  } catch {
    // Ignore — logout of billing state is best-effort.
  }
}

export type RcPrices = {
  founding: { priceString: string } | null;
  standard: { priceString: string } | null;
};

/**
 * Live store prices for the founding / standard packages from the current
 * offering. Never hardcode prices — these come straight from the store via
 * RevenueCat. Returns nulls on web / when unavailable so the caller can fall
 * back to display constants.
 */
export async function getSquadzPlusPrices(): Promise<RcPrices> {
  const empty: RcPrices = { founding: null, standard: null };
  await ensureConfigured();
  const Purchases = await getPurchases();
  if (!Purchases) return empty;
  try {
    const offerings = await Purchases.getOfferings();
    const pkgs = offerings.current?.availablePackages ?? [];
    const f = pkgs.find((p) => productMatches(p.product.identifier, RC_FOUNDING_PRODUCT_ID));
    const s = pkgs.find((p) => productMatches(p.product.identifier, RC_STANDARD_PRODUCT_ID));
    return {
      founding: f ? { priceString: f.product.priceString } : null,
      standard: s ? { priceString: s.product.priceString } : null,
    };
  } catch {
    return empty;
  }
}

/** Which price tier an active entitlement was purchased at. */
export type SquadzPlusTier = "founding" | "standard" | "none";

/**
 * A resolved read of the on-device RevenueCat entitlement.
 *
 * `tier` is provenance for the founding badge, never the access decision —
 * `entitled` alone decides access. An entitled user whose product id RevenueCat
 * didn't report (or that isn't one of ours) reads as "standard" rather than
 * "none", so an unknown product can never present as un-entitled.
 */
export type RcEntitlement = { entitled: boolean; tier: SquadzPlusTier };

const NOT_ENTITLED: RcEntitlement = { entitled: false, tier: "none" };

/** Map a store product identifier to its tier (handles the Android "id:basePlan" form). */
export function tierForProductId(identifier: string | null | undefined): SquadzPlusTier {
  if (productMatches(identifier, RC_FOUNDING_PRODUCT_ID)) return "founding";
  if (productMatches(identifier, RC_STANDARD_PRODUCT_ID)) return "standard";
  return "none";
}

// Identifiers already reported this session, so a listener firing repeatedly
// (RevenueCat re-emits CustomerInfo on every app foreground) can't flood Sentry.
const _reportedUnknownProducts = new Set<string>();

/**
 * Telemetry for the "entitled, but the product id isn't one of ours" fallback.
 *
 * That fallback is deliberately silent to the user (they keep access as
 * `standard`), which is exactly why it needs a signal: it is what hid the wrong
 * product constants for as long as it did. If the store ids or Play base plans
 * change again, this fires instead of the app quietly reclassifying founding
 * members as standard.
 *
 * Best-effort and never throws — Sentry is dynamically imported so the web
 * bundle and node-based unit tests never load the native module.
 */
function reportUnknownEntitlementProduct(identifier: string | null | undefined): void {
  const id = identifier ?? "(none)";
  if (_reportedUnknownProducts.has(id)) return;
  _reportedUnknownProducts.add(id);
  void (async () => {
    try {
      const { Sentry } = await import("@/lib/monitoring");
      Sentry.captureMessage(
        `Squadz+ entitlement active with unrecognized product identifier: ${id}`,
        "warning",
      );
    } catch {
      // Monitoring unavailable (web bundle / tests) — the fallback still works.
    }
  })();
}

/** Test-only: clear the once-per-identifier Sentry dedupe. */
export function __resetUnknownProductReports(): void {
  _reportedUnknownProducts.clear();
}

// The shape we need off a CustomerInfo without importing the native types into
// the web bundle. Structural, so the real SDK type satisfies it.
type CustomerInfoLike = {
  entitlements: {
    active: Record<string, { productIdentifier?: string | null } | undefined>;
  };
};

/**
 * Derive the entitlement from a RevenueCat CustomerInfo. Shared by purchase,
 * restore, the launch read and the customer-info listener so every path agrees
 * on what "entitled" means.
 */
export function entitlementFromCustomerInfo(info: CustomerInfoLike): RcEntitlement {
  const ent = info.entitlements.active[RC_ENTITLEMENT_ID];
  if (!ent) return NOT_ENTITLED;
  const tier = tierForProductId(ent.productIdentifier);
  // Entitled but unrecognized product → treat as standard, never as "none".
  // Report it: silently reclassifying a paying member is how the wrong product
  // constants went unnoticed.
  if (tier === "none") {
    reportUnknownEntitlementProduct(ent.productIdentifier);
    return { entitled: true, tier: "standard" };
  }
  return { entitled: true, tier };
}

export type PurchaseOutcome =
  | { ok: true; isPro: boolean; entitlement: RcEntitlement }
  | { ok: false; cancelled?: boolean; error: string };

/**
 * Purchase SquadZ+. `preferFounding` selects the founding package while spots
 * remain (server truth via /api/subscription/founding-status); falls back to the
 * standard package. The actual founding-spot consumption happens server-side in
 * the RevenueCat webhook when payment is confirmed — this only picks which
 * package to buy.
 */
export async function purchaseSquadzPlus(preferFounding: boolean): Promise<PurchaseOutcome> {
  if (Platform.OS === "web") {
    return { ok: false, error: "SquadZ+ is available in the SquadZ mobile app." };
  }
  await ensureConfigured();
  const Purchases = await getPurchases();
  if (!Purchases) {
    return { ok: false, error: "In-app purchases aren't available right now." };
  }
  try {
    const offerings = await Purchases.getOfferings();
    const pkgs = offerings.current?.availablePackages ?? [];
    if (pkgs.length === 0) {
      return { ok: false, error: "No subscription options are available right now." };
    }
    const wanted = preferFounding ? RC_FOUNDING_PRODUCT_ID : RC_STANDARD_PRODUCT_ID;
    const pkg =
      pkgs.find((p) => productMatches(p.product.identifier, wanted)) ??
      pkgs.find((p) => productMatches(p.product.identifier, RC_STANDARD_PRODUCT_ID)) ??
      pkgs[0];
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const entitlement = entitlementFromCustomerInfo(customerInfo);
    return { ok: true, isPro: entitlement.entitled, entitlement };
  } catch (err) {
    const e = err as { userCancelled?: boolean; message?: string };
    if (e?.userCancelled) return { ok: false, cancelled: true, error: "Purchase cancelled." };
    return { ok: false, error: e?.message ?? "Purchase failed. Please try again." };
  }
}

/**
 * Whether the on-device RevenueCat customer info currently has the SquadZ+
 * entitlement active. Returns null when the SDK is unavailable (web / not
 * configured) so callers can distinguish "no" from "unknown".
 */
export async function getLocalEntitlementActive(): Promise<boolean | null> {
  const ent = await getLocalEntitlement();
  return ent === null ? null : ent.entitled;
}

/**
 * Tier-aware version of `getLocalEntitlementActive`. Null = unknown (web / SDK
 * unavailable), which callers must NOT collapse into "not entitled".
 */
export async function getLocalEntitlement(): Promise<RcEntitlement | null> {
  if (Platform.OS === "web") return null;
  await ensureConfigured();
  const Purchases = await getPurchases();
  if (!Purchases || !_configured) return null;
  try {
    const info = await Purchases.getCustomerInfo();
    return entitlementFromCustomerInfo(info);
  } catch {
    return null;
  }
}

/**
 * Subscribe to RevenueCat customer-info updates (renewals, expiries, Ask-to-Buy
 * approvals, purchases made on another device). Returns an unsubscribe function;
 * a no-op one on web / when the SDK is unavailable, so callers can always call it
 * from a cleanup without branching.
 *
 * Exactly ONE listener should be registered app-wide — see RevenueCatConnector.
 */
export async function addEntitlementListener(
  onChange: (entitlement: RcEntitlement) => void,
): Promise<() => void> {
  if (Platform.OS === "web") return () => {};
  const Purchases = await getPurchases();
  if (!Purchases) return () => {};
  const listener = (info: CustomerInfoLike) => {
    try {
      onChange(entitlementFromCustomerInfo(info));
    } catch {
      // A throwing subscriber must never break the SDK's listener chain.
    }
  };
  try {
    Purchases.addCustomerInfoUpdateListener(listener);
  } catch {
    return () => {};
  }
  return () => {
    try {
      Purchases.removeCustomerInfoUpdateListener(listener);
    } catch {
      // Already torn down — nothing to do.
    }
  };
}

/** Restore previous purchases (e.g. after reinstall / new device). */
export async function restoreSquadzPlus(): Promise<PurchaseOutcome> {
  if (Platform.OS === "web") {
    return { ok: false, error: "Restore is available in the SquadZ mobile app." };
  }
  await ensureConfigured();
  const Purchases = await getPurchases();
  if (!Purchases) {
    return { ok: false, error: "Restore isn't available right now." };
  }
  try {
    const info = await Purchases.restorePurchases();
    const entitlement = entitlementFromCustomerInfo(info);
    return { ok: true, isPro: entitlement.entitled, entitlement };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e?.message ?? "Couldn't restore purchases." };
  }
}
