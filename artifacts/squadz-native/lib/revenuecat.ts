import { Platform } from "react-native";

// RevenueCat product / entitlement identifiers. MUST match the RevenueCat
// dashboard AND the server (artifacts/api-server/src/lib/revenuecat.ts).
export const RC_ENTITLEMENT_ID = "squadz_plus";
export const RC_FOUNDING_PRODUCT_ID = "squadz_plus_founding_yearly";
export const RC_STANDARD_PRODUCT_ID = "squadz_plus_standard_yearly";

type PurchasesModule = typeof import("react-native-purchases");
type PurchasesDefault = PurchasesModule["default"];

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
 * Configure RevenueCat and identify the current user (app_user_id = Squadz user
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
    const f = pkgs.find((p) => p.product.identifier === RC_FOUNDING_PRODUCT_ID);
    const s = pkgs.find((p) => p.product.identifier === RC_STANDARD_PRODUCT_ID);
    return {
      founding: f ? { priceString: f.product.priceString } : null,
      standard: s ? { priceString: s.product.priceString } : null,
    };
  } catch {
    return empty;
  }
}

export type PurchaseOutcome =
  | { ok: true; isPro: boolean }
  | { ok: false; cancelled?: boolean; error: string };

/**
 * Purchase Squadz+. `preferFounding` selects the founding package while spots
 * remain (server truth via /api/subscription/founding-status); falls back to the
 * standard package. The actual founding-spot consumption happens server-side in
 * the RevenueCat webhook when payment is confirmed — this only picks which
 * package to buy.
 */
export async function purchaseSquadzPlus(preferFounding: boolean): Promise<PurchaseOutcome> {
  if (Platform.OS === "web") {
    return { ok: false, error: "Squadz+ is available in the Squadz mobile app." };
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
      pkgs.find((p) => p.product.identifier === wanted) ??
      pkgs.find((p) => p.product.identifier === RC_STANDARD_PRODUCT_ID) ??
      pkgs[0];
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { ok: true, isPro: !!customerInfo.entitlements.active[RC_ENTITLEMENT_ID] };
  } catch (err) {
    const e = err as { userCancelled?: boolean; message?: string };
    if (e?.userCancelled) return { ok: false, cancelled: true, error: "Purchase cancelled." };
    return { ok: false, error: e?.message ?? "Purchase failed. Please try again." };
  }
}

/** Restore previous purchases (e.g. after reinstall / new device). */
export async function restoreSquadzPlus(): Promise<PurchaseOutcome> {
  if (Platform.OS === "web") {
    return { ok: false, error: "Restore is available in the Squadz mobile app." };
  }
  await ensureConfigured();
  const Purchases = await getPurchases();
  if (!Purchases) {
    return { ok: false, error: "Restore isn't available right now." };
  }
  try {
    const info = await Purchases.restorePurchases();
    return { ok: true, isPro: !!info.entitlements.active[RC_ENTITLEMENT_ID] };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e?.message ?? "Couldn't restore purchases." };
  }
}
