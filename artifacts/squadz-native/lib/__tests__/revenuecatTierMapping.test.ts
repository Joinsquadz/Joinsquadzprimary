/**
 * Squadz+ product-identifier → tier mapping on the client, plus the telemetry
 * that fires when an ACTIVE entitlement reports a product we don't recognise.
 *
 * The App Store and Play catalog use different identifiers for the same tier.
 * These tests pin the real identifiers (bare App Store form and Play
 * "{subscriptionId}:{basePlanId}" form) and prove the fallback reports an
 * unrecognized product instead of hiding a catalog mismatch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { platform, captureMessage } = vi.hoisted(() => ({
  platform: { OS: "ios" as "ios" | "android" | "web" },
  captureMessage: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: platform }));

// lib/monitoring pulls in @sentry/react-native (native module) — mock it so the
// dynamic import inside the fallback resolves under plain node.
vi.mock("@/lib/monitoring", () => ({
  Sentry: { captureMessage: (...args: unknown[]) => captureMessage(...args) },
  initMonitoring: vi.fn(),
}));

import {
  RC_ENTITLEMENT_ID,
  RC_IOS_FOUNDING_PRODUCT_ID,
  RC_IOS_STANDARD_PRODUCT_ID,
  RC_ANDROID_FOUNDING_PRODUCT_ID,
  RC_ANDROID_STANDARD_PRODUCT_ID,
  entitlementFromCustomerInfo,
  productMatches,
  tierForProductId,
  __resetUnknownProductReports,
} from "@/lib/revenuecat";

// Written out literally so a silent constant edit fails here rather than
// passing tautologically against itself.
const REAL_FOUNDING = "com.squadz.app.squadzplus.founding.annual";
const REAL_STANDARD = "com.squadz.app.squadzplus.standard.annual";
const PLAY_FOUNDING = "squadz_plus_founding_yearly:founding-yearly";
const PLAY_STANDARD = "squadz_plus_standard_yearly:standard-yearly";

const infoWith = (productIdentifier?: string | null) => ({
  entitlements: {
    active: {
      [RC_ENTITLEMENT_ID]:
        productIdentifier === undefined ? {} : { productIdentifier },
    },
  },
});

/** The report is fire-and-forget inside a promise; let the microtasks drain. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  __resetUnknownProductReports();
  platform.OS = "ios";
});

describe("Squadz+ product constants", () => {
  it("are the real iOS and Android store identifiers", () => {
    expect(RC_IOS_FOUNDING_PRODUCT_ID).toBe(REAL_FOUNDING);
    expect(RC_IOS_STANDARD_PRODUCT_ID).toBe(REAL_STANDARD);
    expect(RC_ANDROID_FOUNDING_PRODUCT_ID).toBe(PLAY_FOUNDING);
    expect(RC_ANDROID_STANDARD_PRODUCT_ID).toBe(PLAY_STANDARD);
  });
});

describe("tierForProductId — real identifiers", () => {
  it("maps the bare App Store ids", () => {
    expect(tierForProductId(REAL_FOUNDING)).toBe("founding");
    expect(tierForProductId(REAL_STANDARD)).toBe("standard");
  });

  it("maps the Play base-plan ids", () => {
    expect(tierForProductId(PLAY_FOUNDING)).toBe("founding");
    expect(tierForProductId(PLAY_STANDARD)).toBe("standard");
  });

  it("does not cross-match, and rejects foreign / absent ids", () => {
    expect(tierForProductId(PLAY_FOUNDING)).not.toBe("standard");
    expect(tierForProductId("com.other.app.pro")).toBe("none");
    expect(tierForProductId(null)).toBe("none");
    // A prefix of our id is not our id.
    expect(tierForProductId("com.squadz.app.squadzplus")).toBe("none");
  });

  it("productMatches agrees on both forms", () => {
    expect(productMatches(PLAY_FOUNDING, RC_ANDROID_FOUNDING_PRODUCT_ID)).toBe(true);
    expect(productMatches(REAL_STANDARD, RC_IOS_STANDARD_PRODUCT_ID)).toBe(true);
    expect(productMatches(PLAY_STANDARD, RC_ANDROID_FOUNDING_PRODUCT_ID)).toBe(false);
  });
});

describe("entitlementFromCustomerInfo — real identifiers", () => {
  it("resolves founding from the real founding product (both forms)", () => {
    expect(entitlementFromCustomerInfo(infoWith(REAL_FOUNDING))).toEqual({
      entitled: true,
      tier: "founding",
    });
    expect(entitlementFromCustomerInfo(infoWith(PLAY_FOUNDING))).toEqual({
      entitled: true,
      tier: "founding",
    });
  });

  it("resolves standard from the real standard product (both forms)", () => {
    expect(entitlementFromCustomerInfo(infoWith(REAL_STANDARD))).toEqual({
      entitled: true,
      tier: "standard",
    });
    expect(entitlementFromCustomerInfo(infoWith(PLAY_STANDARD))).toEqual({
      entitled: true,
      tier: "standard",
    });
  });

  it("emits no telemetry when the product is recognised", async () => {
    entitlementFromCustomerInfo(infoWith(REAL_FOUNDING));
    await flush();
    expect(captureMessage).not.toHaveBeenCalled();
  });
});

describe("entitled-but-unrecognized fallback", () => {
  it("still grants access as standard (never 'none')", () => {
    expect(entitlementFromCustomerInfo(infoWith("com.squadz.app.newplan.monthly"))).toEqual({
      entitled: true,
      tier: "standard",
    });
  });

  it("reports the unrecognized identifier to Sentry", async () => {
    entitlementFromCustomerInfo(infoWith("com.squadz.app.newplan.monthly"));
    await flush();
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [message, level] = captureMessage.mock.calls[0] as [string, string];
    expect(message).toContain("com.squadz.app.newplan.monthly");
    expect(level).toBe("warning");
  });

  it("reports a missing product identifier too", async () => {
    entitlementFromCustomerInfo(infoWith(undefined));
    await flush();
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it("reports each identifier only once per session (listener re-fires on every foreground)", async () => {
    entitlementFromCustomerInfo(infoWith("com.squadz.app.newplan.monthly"));
    entitlementFromCustomerInfo(infoWith("com.squadz.app.newplan.monthly"));
    entitlementFromCustomerInfo(infoWith("com.squadz.app.newplan.monthly"));
    await flush();
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it("does not report when there is no active entitlement at all", async () => {
    expect(entitlementFromCustomerInfo({ entitlements: { active: {} } })).toEqual({
      entitled: false,
      tier: "none",
    });
    await flush();
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
