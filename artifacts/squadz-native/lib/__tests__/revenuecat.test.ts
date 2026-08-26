import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above module code, so anything they close over
// must be created via vi.hoisted (also hoisted) rather than a plain const.
const {
  platform,
  purchasePackage,
  getOfferings,
  restorePurchases,
  getCustomerInfo,
  addCustomerInfoUpdateListener,
  removeCustomerInfoUpdateListener,
} = vi.hoisted(() => ({
  // react-native's Platform.OS drives which SDK key/path is used. Keep it
  // mutable so tests can flip between "android" and "ios".
  platform: { OS: "android" as "android" | "ios" | "web" },
  purchasePackage: vi.fn(),
  getOfferings: vi.fn(),
  restorePurchases: vi.fn(),
  getCustomerInfo: vi.fn(),
  addCustomerInfoUpdateListener: vi.fn(),
  removeCustomerInfoUpdateListener: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: platform }));

// Mock the native SDK (dynamically imported inside lib/revenuecat.ts). Each test
// swaps in the offerings / purchase behaviour it wants.
vi.mock("react-native-purchases", () => ({
  default: {
    configure: vi.fn(),
    logIn: vi.fn(),
    logOut: vi.fn(),
    getOfferings: (...args: unknown[]) => getOfferings(...args),
    purchasePackage: (...args: unknown[]) => purchasePackage(...args),
    restorePurchases: (...args: unknown[]) => restorePurchases(...args),
    getCustomerInfo: (...args: unknown[]) => getCustomerInfo(...args),
    addCustomerInfoUpdateListener: (...args: unknown[]) =>
      addCustomerInfoUpdateListener(...args),
    removeCustomerInfoUpdateListener: (...args: unknown[]) =>
      removeCustomerInfoUpdateListener(...args),
  },
}));

import {
  productMatches,
  purchaseSquadzPlus,
  getSquadzPlusPrices,
  configureRevenueCat,
  getLocalEntitlementActive,
  restoreSquadzPlus,
  addEntitlementListener,
  RC_FOUNDING_PRODUCT_ID,
  RC_STANDARD_PRODUCT_ID,
  RC_LEGACY_FOUNDING_PRODUCT_ID,
  RC_LEGACY_STANDARD_PRODUCT_ID,
  RC_ENTITLEMENT_ID,
  tierForProductId,
  hasLiveFoundingPrice,
} from "@/lib/revenuecat";

// A Google Play subscription StoreProduct identifier is "{subId}:{basePlanId}".
const ANDROID_FOUNDING_ID = `${RC_LEGACY_FOUNDING_PRODUCT_ID}:founding-yearly`;
const ANDROID_STANDARD_ID = `${RC_LEGACY_STANDARD_PRODUCT_ID}:standard-yearly`;

function pkg(identifier: string, priceString = "$0.00") {
  return { product: { identifier, priceString } };
}

function offeringsWith(...packages: ReturnType<typeof pkg>[]) {
  return { current: { availablePackages: packages } };
}

beforeEach(() => {
  vi.clearAllMocks();
  platform.OS = "android";
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = "goog_test";
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "appl_test";
});

describe("productMatches (Android subId:basePlanId format)", () => {
  it("matches the base subscription id against a Play identifier", () => {
    expect(productMatches(ANDROID_FOUNDING_ID, RC_LEGACY_FOUNDING_PRODUCT_ID)).toBe(true);
    expect(productMatches(ANDROID_STANDARD_ID, RC_LEGACY_STANDARD_PRODUCT_ID)).toBe(true);
  });

  it("still matches the plain iOS identifier (no base-plan suffix)", () => {
    expect(productMatches(RC_FOUNDING_PRODUCT_ID, RC_FOUNDING_PRODUCT_ID)).toBe(true);
  });

  it("does not cross-match founding vs standard", () => {
    expect(productMatches(ANDROID_FOUNDING_ID, RC_STANDARD_PRODUCT_ID)).toBe(false);
    expect(productMatches(ANDROID_STANDARD_ID, RC_FOUNDING_PRODUCT_ID)).toBe(false);
  });

  it("is false for empty / missing identifiers", () => {
    expect(productMatches("", RC_FOUNDING_PRODUCT_ID)).toBe(false);
    expect(productMatches(null, RC_FOUNDING_PRODUCT_ID)).toBe(false);
    expect(productMatches(undefined, RC_FOUNDING_PRODUCT_ID)).toBe(false);
  });
});

describe("tierForProductId accepts every live identifier form", () => {
  const identifiers = [
    [RC_FOUNDING_PRODUCT_ID, "founding"],
    [`${RC_FOUNDING_PRODUCT_ID}:founding-yearly`, "founding"],
    [RC_LEGACY_FOUNDING_PRODUCT_ID, "founding"],
    [ANDROID_FOUNDING_ID, "founding"],
    [RC_STANDARD_PRODUCT_ID, "standard"],
    [`${RC_STANDARD_PRODUCT_ID}:standard-yearly`, "standard"],
    [RC_LEGACY_STANDARD_PRODUCT_ID, "standard"],
    [ANDROID_STANDARD_ID, "standard"],
  ] as const;

  it.each(identifiers)("maps %s to %s", (identifier, tier) => {
    expect(tierForProductId(identifier)).toBe(tier);
  });
});

describe("purchaseSquadzPlus on Android (Play subId:basePlanId identifiers)", () => {
  it("selects the FOUNDING package (not the standard fallback) when founding is preferred", async () => {
    await configureRevenueCat("user-1");
    const foundingPkg = pkg(ANDROID_FOUNDING_ID, "$19.99");
    const standardPkg = pkg(ANDROID_STANDARD_ID, "$29.99");
    getOfferings.mockResolvedValue(offeringsWith(standardPkg, foundingPkg));
    // The entitlement reports the Play-style "subId:basePlanId" identifier, which
    // is what the tier is derived from — a bare {} would resolve to "standard"
    // and silently hide a founding purchase behind the standard badge.
    purchasePackage.mockResolvedValue({
      customerInfo: {
        entitlements: {
          active: { [RC_ENTITLEMENT_ID]: { productIdentifier: ANDROID_FOUNDING_ID } },
        },
      },
    });

    const res = await purchaseSquadzPlus(true);

    expect(purchasePackage).toHaveBeenCalledTimes(1);
    // The bug: exact === match would fall through to standard on Android.
    expect(purchasePackage).toHaveBeenCalledWith(foundingPkg);
    expect(res).toEqual({ ok: true, isPro: true, entitlement: { entitled: true, tier: "founding" } });
  });

  it("selects the STANDARD package when founding is not preferred", async () => {
    await configureRevenueCat("user-1");
    const foundingPkg = pkg(ANDROID_FOUNDING_ID, "$19.99");
    const standardPkg = pkg(ANDROID_STANDARD_ID, "$29.99");
    getOfferings.mockResolvedValue(offeringsWith(foundingPkg, standardPkg));
    purchasePackage.mockResolvedValue({
      customerInfo: { entitlements: { active: { [RC_ENTITLEMENT_ID]: {} } } },
    });

    await purchaseSquadzPlus(false);

    expect(purchasePackage).toHaveBeenCalledWith(standardPkg);
  });

  it("resolves the entitlement as inactive when Play grants no squadz_plus entitlement", async () => {
    await configureRevenueCat("user-1");
    getOfferings.mockResolvedValue(offeringsWith(pkg(ANDROID_FOUNDING_ID)));
    purchasePackage.mockResolvedValue({
      customerInfo: { entitlements: { active: {} } },
    });

    const res = await purchaseSquadzPlus(true);
    expect(res).toEqual({ ok: true, isPro: false, entitlement: { entitled: false, tier: "none" } });
  });

  it("does not buy the first package when the requested tier is absent", async () => {
    await configureRevenueCat("user-1");
    const foundingPkg = pkg(ANDROID_FOUNDING_ID, "$19.99");
    getOfferings.mockResolvedValue(offeringsWith(foundingPkg));

    const res = await purchaseSquadzPlus(false);

    expect(purchasePackage).not.toHaveBeenCalled();
    expect(res).toEqual({
      ok: false,
      error: "That subscription option isn't available right now. Please try again.",
    });
  });
});

describe("getSquadzPlusPrices on Android", () => {
  it("reads live prices off Play subId:basePlanId identifiers", async () => {
    await configureRevenueCat("user-1");
    getOfferings.mockResolvedValue(
      offeringsWith(pkg(ANDROID_FOUNDING_ID, "$19.99"), pkg(ANDROID_STANDARD_ID, "$29.99")),
    );

    const prices = await getSquadzPlusPrices();
    expect(prices).toEqual({
      founding: { priceString: "$19.99" },
      standard: { priceString: "$29.99" },
    });
  });
});

describe("hasLiveFoundingPrice", () => {
  it("only allows the founding display when RevenueCat resolved a non-empty founding package price", () => {
    expect(hasLiveFoundingPrice({ founding: { priceString: "$19.99" }, standard: { priceString: "$29.99" } })).toBe(true);
    expect(hasLiveFoundingPrice({ founding: null, standard: { priceString: "$29.99" } })).toBe(false);
    expect(hasLiveFoundingPrice({ founding: { priceString: "" }, standard: { priceString: "$29.99" } })).toBe(false);
  });
});

// Helpers for customer-info shaped responses.
function customerInfoWith(entitlementActive: boolean) {
  return {
    entitlements: {
      active: entitlementActive ? { [RC_ENTITLEMENT_ID]: {} } : {},
    },
  };
}

describe("getLocalEntitlementActive", () => {
  it("returns true when the entitlement is active on-device", async () => {
    await configureRevenueCat("user-1");
    getCustomerInfo.mockResolvedValue(customerInfoWith(true));

    const result = await getLocalEntitlementActive();
    expect(result).toBe(true);
  });

  it("returns false when the entitlement is not active", async () => {
    await configureRevenueCat("user-1");
    getCustomerInfo.mockResolvedValue(customerInfoWith(false));

    const result = await getLocalEntitlementActive();
    expect(result).toBe(false);
  });

  it("returns null on web (SDK unavailable)", async () => {
    platform.OS = "web" as typeof platform.OS;

    const result = await getLocalEntitlementActive();
    expect(result).toBeNull();
  });
});

describe("restoreSquadzPlus", () => {
  it("returns ok:true with isPro:true when the restored entitlement is active", async () => {
    await configureRevenueCat("user-1");
    restorePurchases.mockResolvedValue(customerInfoWith(true));

    const result = await restoreSquadzPlus();
    expect(result).toEqual({ ok: true, isPro: true, entitlement: { entitled: true, tier: "standard" } });
  });

  it("returns ok:true with isPro:false when there is nothing to restore", async () => {
    await configureRevenueCat("user-1");
    restorePurchases.mockResolvedValue(customerInfoWith(false));

    const result = await restoreSquadzPlus();
    expect(result).toEqual({ ok: true, isPro: false, entitlement: { entitled: false, tier: "none" } });
  });

  it("returns ok:false with the error message on SDK failure", async () => {
    await configureRevenueCat("user-1");
    restorePurchases.mockRejectedValue(new Error("Store error"));

    const result = await restoreSquadzPlus();
    expect(result).toEqual({ ok: false, error: "Store error" });
  });
});

describe("auto-restore flow: server=false, RC=true → restore fires → entitlement synced", () => {
  it("restore is called and returns isPro:true when RC has an active entitlement", async () => {
    // Scenario: user reinstalled — server says not Pro but RC on-device says active.
    await configureRevenueCat("user-1");

    // RC local state: entitlement active.
    getCustomerInfo.mockResolvedValue(customerInfoWith(true));
    // restorePurchases re-validates with the store and confirms the entitlement.
    restorePurchases.mockResolvedValue(customerInfoWith(true));

    const local = await getLocalEntitlementActive();
    expect(local).toBe(true); // RC says entitled

    // Simulate server reporting false (new device / reinstall).
    const serverPro = false;

    // The connector branches: local && !serverPro → restore then sync.
    let restoreCalled = false;
    if (local && !serverPro) {
      const restoreResult = await restoreSquadzPlus();
      restoreCalled = true;
      expect(restoreResult).toEqual({ ok: true, isPro: true, entitlement: { entitled: true, tier: "standard" } });
    }

    expect(restoreCalled).toBe(true);
    expect(restorePurchases).toHaveBeenCalledTimes(1);
  });

  it("restore is NOT called when RC and server already agree", async () => {
    await configureRevenueCat("user-1");
    getCustomerInfo.mockResolvedValue(customerInfoWith(true));

    const local = await getLocalEntitlementActive();
    const serverPro = true; // both agree → no restore needed

    if (local && !serverPro) {
      await restoreSquadzPlus();
    }

    expect(restorePurchases).not.toHaveBeenCalled();
  });

  it("restore is NOT called when RC is inactive (server=true path only syncs)", async () => {
    await configureRevenueCat("user-1");
    getCustomerInfo.mockResolvedValue(customerInfoWith(false));

    const local = await getLocalEntitlementActive();
    expect(local).toBe(false);

    const serverPro = true; // server=true, RC=false → only sync, no restore

    if (local && !serverPro) {
      await restoreSquadzPlus();
    }

    expect(restorePurchases).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// addEntitlementListener
//
// This is the only path by which an entitlement change that did NOT originate in
// a purchase flow reaches the UI: renewals, expiries, refunds, Ask-to-Buy
// approvals, family sharing, and purchases made on another device.
// ---------------------------------------------------------------------------
describe("addEntitlementListener", () => {
  /** Hand back the callback the SDK was registered with. */
  function registeredListener() {
    const call = addCustomerInfoUpdateListener.mock.calls[0] as [
      (info: unknown) => void,
    ];
    return call[0];
  }

  it("reports an entitlement change as a mapped RcEntitlement, not raw customer info", async () => {
    await configureRevenueCat("user-1");
    const onChange = vi.fn();

    await addEntitlementListener(onChange);
    registeredListener()(customerInfoWith(true));

    expect(onChange).toHaveBeenCalledWith({ entitled: true, tier: "standard" });
  });

  it("carries the tier through from the store product id (founding renewal)", async () => {
    await configureRevenueCat("user-1");
    const onChange = vi.fn();

    await addEntitlementListener(onChange);
    registeredListener()({
      entitlements: {
        active: { [RC_ENTITLEMENT_ID]: { productIdentifier: RC_FOUNDING_PRODUCT_ID } },
      },
    });

    expect(onChange).toHaveBeenCalledWith({ entitled: true, tier: "founding" });
  });

  it("reports a lapsed entitlement (expiry / refund arriving via the SDK)", async () => {
    await configureRevenueCat("user-1");
    const onChange = vi.fn();

    await addEntitlementListener(onChange);
    registeredListener()(customerInfoWith(false));

    expect(onChange).toHaveBeenCalledWith({ entitled: false, tier: "none" });
  });

  it("unsubscribing removes the SAME listener reference it registered", async () => {
    // Passing a different function to remove* silently leaves the listener
    // attached, which is how a previous account's listener would keep writing
    // entitlement after a logout.
    await configureRevenueCat("user-1");

    const off = await addEntitlementListener(vi.fn());
    off();

    expect(removeCustomerInfoUpdateListener).toHaveBeenCalledTimes(1);
    expect(removeCustomerInfoUpdateListener).toHaveBeenCalledWith(registeredListener());
  });

  it("a throwing subscriber does not break the SDK listener chain", async () => {
    await configureRevenueCat("user-1");
    const onChange = vi.fn().mockImplementation(() => {
      throw new Error("render error");
    });

    await addEntitlementListener(onChange);

    expect(() => registeredListener()(customerInfoWith(true))).not.toThrow();
  });

  it("is an inert no-op on web, where there is no SDK to listen to", async () => {
    platform.OS = "web";
    const onChange = vi.fn();

    const off = await addEntitlementListener(onChange);

    expect(addCustomerInfoUpdateListener).not.toHaveBeenCalled();
    // The returned unsubscribe must still be safely callable.
    expect(() => off()).not.toThrow();
  });
});
