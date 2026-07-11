import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above module code, so anything they close over
// must be created via vi.hoisted (also hoisted) rather than a plain const.
const { platform, purchasePackage, getOfferings } = vi.hoisted(() => ({
  // react-native's Platform.OS drives which SDK key/path is used. Keep it
  // mutable so tests can flip between "android" and "ios".
  platform: { OS: "android" as "android" | "ios" | "web" },
  purchasePackage: vi.fn(),
  getOfferings: vi.fn(),
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
    restorePurchases: vi.fn(),
  },
}));

import {
  productMatches,
  purchaseSquadzPlus,
  getSquadzPlusPrices,
  configureRevenueCat,
  RC_FOUNDING_PRODUCT_ID,
  RC_STANDARD_PRODUCT_ID,
  RC_ENTITLEMENT_ID,
} from "@/lib/revenuecat";

// A Google Play subscription StoreProduct identifier is "{subId}:{basePlanId}".
const ANDROID_FOUNDING_ID = `${RC_FOUNDING_PRODUCT_ID}:founding-yearly`;
const ANDROID_STANDARD_ID = `${RC_STANDARD_PRODUCT_ID}:standard-yearly`;

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
    expect(productMatches(ANDROID_FOUNDING_ID, RC_FOUNDING_PRODUCT_ID)).toBe(true);
    expect(productMatches(ANDROID_STANDARD_ID, RC_STANDARD_PRODUCT_ID)).toBe(true);
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

describe("purchaseSquadzPlus on Android (Play subId:basePlanId identifiers)", () => {
  it("selects the FOUNDING package (not the standard fallback) when founding is preferred", async () => {
    await configureRevenueCat("user-1");
    const foundingPkg = pkg(ANDROID_FOUNDING_ID, "$19.99");
    const standardPkg = pkg(ANDROID_STANDARD_ID, "$29.99");
    getOfferings.mockResolvedValue(offeringsWith(standardPkg, foundingPkg));
    purchasePackage.mockResolvedValue({
      customerInfo: { entitlements: { active: { [RC_ENTITLEMENT_ID]: {} } } },
    });

    const res = await purchaseSquadzPlus(true);

    expect(purchasePackage).toHaveBeenCalledTimes(1);
    // The bug: exact === match would fall through to standard on Android.
    expect(purchasePackage).toHaveBeenCalledWith(foundingPkg);
    expect(res).toEqual({ ok: true, isPro: true });
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
    expect(res).toEqual({ ok: true, isPro: false });
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
