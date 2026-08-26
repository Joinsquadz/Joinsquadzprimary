/**
 * Product-identifier → Squadz+ tier mapping.
 *
 * The constants in lib/revenuecat.ts previously held invented ids that matched
 * NEITHER the App Store nor Google Play, so every real purchase fell through to
 * the "unrecognized product" path: the webhook stamped a null tier and an
 * Android founding purchase never consumed its founding spot. These tests pin
 * the mapping to the REAL production identifiers, in both the bare (App Store)
 * and `productId:basePlanId` (Google Play) forms.
 */
import { describe, it, expect } from "vitest";
import {
  RC_FOUNDING_PRODUCT_ID,
  RC_STANDARD_PRODUCT_ID,
  RC_LEGACY_FOUNDING_PRODUCT_ID,
  RC_LEGACY_STANDARD_PRODUCT_ID,
  baseProductId,
  isKnownSquadzPlusProduct,
  tierForProductId,
  eventTargetsSquadzPlus,
  shouldRedeemFounding,
  type RevenueCatEvent,
} from "../lib/revenuecat";

// The literal identifiers registered in the stores + RevenueCat dashboard.
// Written out rather than referencing the constants so a silent constant edit
// fails here instead of passing tautologically.
const REAL_FOUNDING = "com.squadz.app.squadzplus.founding.annual";
const REAL_STANDARD = "com.squadz.app.squadzplus.standard.annual";
const LEGACY_FOUNDING = "squadz_plus_founding_yearly";
const LEGACY_STANDARD = "squadz_plus_standard_yearly";

// Google Play reports a subscription StoreProduct as "{productId}:{basePlanId}".
const PLAY_FOUNDING = `${REAL_FOUNDING}:founding-annual`;
const PLAY_STANDARD = `${REAL_STANDARD}:standard-annual`;

describe("Squadz+ product constants", () => {
  it("preserve both the newer and immutable legacy store identifiers", () => {
    expect(RC_FOUNDING_PRODUCT_ID).toBe(REAL_FOUNDING);
    expect(RC_STANDARD_PRODUCT_ID).toBe(REAL_STANDARD);
    expect(RC_LEGACY_FOUNDING_PRODUCT_ID).toBe(LEGACY_FOUNDING);
    expect(RC_LEGACY_STANDARD_PRODUCT_ID).toBe(LEGACY_STANDARD);
  });
});

describe("tierForProductId", () => {
  it.each([
    [REAL_FOUNDING, "founding"],
    [PLAY_FOUNDING, "founding"],
    [LEGACY_FOUNDING, "founding"],
    [`${LEGACY_FOUNDING}:founding-yearly`, "founding"],
    [REAL_STANDARD, "standard"],
    [PLAY_STANDARD, "standard"],
    [LEGACY_STANDARD, "standard"],
    [`${LEGACY_STANDARD}:standard-yearly`, "standard"],
  ] as const)("maps %s to %s", (identifier, tier) => {
    expect(tierForProductId(identifier)).toBe(tier);
  });

  it("does not cross-match founding and standard", () => {
    expect(tierForProductId(PLAY_FOUNDING)).not.toBe("standard");
    expect(tierForProductId(PLAY_STANDARD)).not.toBe("founding");
  });

  it("returns null for absent or foreign identifiers", () => {
    expect(tierForProductId(null)).toBeNull();
    expect(tierForProductId(undefined)).toBeNull();
    expect(tierForProductId("")).toBeNull();
    expect(tierForProductId("com.someone.else.annual")).toBeNull();
    // Prefix-only, not our product: must not match by string containment.
    expect(tierForProductId("com.squadz.app.squadzplus")).toBeNull();
  });
});

describe("baseProductId / isKnownSquadzPlusProduct", () => {
  it("strips the Play base plan suffix and leaves bare ids alone", () => {
    expect(baseProductId(PLAY_FOUNDING)).toBe(REAL_FOUNDING);
    expect(baseProductId(REAL_STANDARD)).toBe(REAL_STANDARD);
    expect(baseProductId(null)).toBeNull();
    expect(baseProductId("")).toBeNull();
  });

  it("recognises our products in either form", () => {
    expect(isKnownSquadzPlusProduct(REAL_FOUNDING)).toBe(true);
    expect(isKnownSquadzPlusProduct(PLAY_STANDARD)).toBe(true);
    expect(isKnownSquadzPlusProduct(LEGACY_FOUNDING)).toBe(true);
    expect(isKnownSquadzPlusProduct(`${LEGACY_STANDARD}:standard-yearly`)).toBe(true);
    expect(isKnownSquadzPlusProduct("com.other.app.pro")).toBe(false);
  });
});

describe("eventTargetsSquadzPlus — product-id fallback", () => {
  const ev = (over: Partial<RevenueCatEvent>): RevenueCatEvent => ({
    type: "INITIAL_PURCHASE",
    app_user_id: "u1",
    ...over,
  });

  it("matches on a real bare product id when entitlement ids are absent", () => {
    expect(eventTargetsSquadzPlus(ev({ product_id: REAL_STANDARD }))).toBe(true);
  });

  it("matches on a Play base-plan product id when entitlement ids are absent", () => {
    // Exact equality here used to fail, so an Android event carrying no
    // entitlement_ids was ignored entirely.
    expect(eventTargetsSquadzPlus(ev({ product_id: PLAY_FOUNDING }))).toBe(true);
  });

  it("matches on the live legacy Play product id when entitlement ids are absent", () => {
    expect(eventTargetsSquadzPlus(ev({ product_id: `${LEGACY_FOUNDING}:founding-yearly` }))).toBe(true);
  });

  it("still ignores a foreign product with no Squadz+ entitlement id", () => {
    expect(eventTargetsSquadzPlus(ev({ product_id: "com.other.app.pro" }))).toBe(false);
  });
});

describe("shouldRedeemFounding — real identifiers", () => {
  const founding = (over: Partial<RevenueCatEvent> = {}): RevenueCatEvent => ({
    type: "INITIAL_PURCHASE",
    app_user_id: "u1",
    product_id: REAL_FOUNDING,
    period_type: "NORMAL",
    original_transaction_id: "1000000123",
    ...over,
  });

  it("redeems for a paid founding purchase on the App Store id", () => {
    expect(shouldRedeemFounding(founding())).toBe(true);
  });

  it("redeems for a paid founding purchase on the Play base-plan id", () => {
    // The Android founding-spot leak: an exact === comparison never fired here.
    expect(shouldRedeemFounding(founding({ product_id: PLAY_FOUNDING }))).toBe(true);
  });

  it("redeems for a paid founding purchase on the live legacy Play id", () => {
    expect(shouldRedeemFounding(founding({ product_id: `${LEGACY_FOUNDING}:founding-yearly` }))).toBe(true);
  });

  it("never redeems for the standard product in either form", () => {
    expect(shouldRedeemFounding(founding({ product_id: REAL_STANDARD }))).toBe(false);
    expect(shouldRedeemFounding(founding({ product_id: PLAY_STANDARD }))).toBe(false);
  });

  it("still refuses non-paid founding periods", () => {
    expect(shouldRedeemFounding(founding({ period_type: "TRIAL" }))).toBe(false);
    expect(shouldRedeemFounding(founding({ product_id: PLAY_FOUNDING, period_type: "PROMOTIONAL" }))).toBe(
      false,
    );
  });
});
