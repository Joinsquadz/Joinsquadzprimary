/**
 * Integration tests for reconcileRcEntitlement (lib/rcReconcile.ts).
 *
 * These tests call the production function that RevenueCatConnector
 * (_layout.tsx) delegates to on every launch, exercising the full sequence:
 *
 *   configureRevenueCat
 *     → getLocalEntitlementActive   (RC SDK on-device check)
 *     → fetch /api/subscription      (server-side Pro status)
 *     → restoreSquadzPlus            (store re-validation, Case 1 only)
 *     → syncIapEntitlement           (POST /api/iap/sync)
 *     → refreshUsers                 (bust user-cache so Pro ring appears)
 *
 * The fetch and sync dependencies are injected via the ReconcileDeps interface
 * so no real HTTP requests are made while the RC SDK and its wiring remain the
 * actual production code paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — created before any module code runs
// ---------------------------------------------------------------------------
const { platform, getCustomerInfo, restorePurchases } = vi.hoisted(() => ({
  platform: { OS: "android" as "android" | "ios" | "web" },
  getCustomerInfo: vi.fn(),
  restorePurchases: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: platform }));

vi.mock("react-native-purchases", () => ({
  default: {
    configure: vi.fn(),
    logIn: vi.fn(),
    logOut: vi.fn(),
    getOfferings: vi.fn(),
    purchasePackage: vi.fn(),
    restorePurchases: (...args: unknown[]) => restorePurchases(...args),
    getCustomerInfo: (...args: unknown[]) => getCustomerInfo(...args),
  },
}));

// lib/api is needed only for its re-exports used by rcReconcile; mock it so
// no real fetch or network paths are taken by accident.
vi.mock("@/lib/api", () => ({
  API_BASE: "",
  buildAuthHeaders: (token: string | null) =>
    token ? { Authorization: `Bearer ${token}` } : {},
  // syncIapEntitlement is NOT mocked here — tests supply it via the syncFn
  // injectable, so the production import resolves without issue.
  syncIapEntitlement: vi.fn(),
}));

import { RC_ENTITLEMENT_ID, configureRevenueCat } from "@/lib/revenuecat";
import { reconcileRcEntitlement, type ReconcileDeps } from "@/lib/rcReconcile";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function customerInfoWith(entitlementActive: boolean) {
  return {
    entitlements: {
      active: entitlementActive ? { [RC_ENTITLEMENT_ID]: {} } : {},
    },
  };
}

function mockResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

/**
 * Test doubles keep the loose `vi.fn()` mock type (so `.mockResolvedValue` /
 * `toHaveBeenCalledWith` stay ergonomic) while the returned object is typed as
 * the real `ReconcileDeps`, which is what the production function requires.
 */
type MockFn = ReturnType<typeof vi.fn>;
type TestDeps = ReconcileDeps & {
  fetchFn: MockFn;
  syncFn: MockFn;
  refreshUsers: MockFn;
};

/** Standard set of injectable test doubles for one test scenario. */
function makeDeps({
  authToken = "tok",
  userId = "u1",
  serverIsPro,
  fetchMock,
  syncMock,
  refreshUsers,
}: {
  authToken?: string | null;
  userId?: string;
  serverIsPro: boolean;
  fetchMock?: MockFn;
  syncMock?: MockFn;
  refreshUsers?: MockFn;
}): TestDeps {
  const fetchFn = fetchMock ?? vi.fn().mockResolvedValue(mockResponse({ isPro: serverIsPro }));
  const syncFn = syncMock ?? vi.fn().mockResolvedValue(true);
  const refresh = refreshUsers ?? vi.fn();
  return { authToken, userId, refreshUsers: refresh, fetchFn, syncFn } as unknown as TestDeps;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------
beforeEach(async () => {
  vi.clearAllMocks();
  platform.OS = "android";
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = "goog_test";
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "appl_test";
  // Pre-configure RC so getLocalEntitlementActive can call the SDK.
  await configureRevenueCat("u1");
});

// ---------------------------------------------------------------------------
// Case 1 — RC active, server false (reinstall / new device)
// ---------------------------------------------------------------------------
describe("reconcileRcEntitlement: RC=true, server=false (reinstall scenario)", () => {
  it("calls restorePurchases exactly once", async () => {
    getCustomerInfo.mockResolvedValue(customerInfoWith(true));
    restorePurchases.mockResolvedValue(customerInfoWith(true));
    const deps = makeDeps({ serverIsPro: false });

    await reconcileRcEntitlement(deps);

    expect(restorePurchases).toHaveBeenCalledTimes(1);
  });

  it("calls syncFn (POST /api/iap/sync) after restore", async () => {
    getCustomerInfo.mockResolvedValue(customerInfoWith(true));
    restorePurchases.mockResolvedValue(customerInfoWith(true));
    const deps = makeDeps({ serverIsPro: false });

    await reconcileRcEntitlement(deps);

    expect(deps.syncFn).toHaveBeenCalledTimes(1);
    expect(deps.syncFn).toHaveBeenCalledWith("tok");
  });

  it("syncFn is called AFTER restorePurchases (ordering)", async () => {
    const callOrder: string[] = [];
    getCustomerInfo.mockResolvedValue(customerInfoWith(true));
    restorePurchases.mockImplementation(async () => {
      callOrder.push("restorePurchases");
      return customerInfoWith(true);
    });
    const syncMock = vi.fn().mockImplementation(async () => {
      callOrder.push("syncFn");
      return true;
    });
    const deps = makeDeps({ serverIsPro: false, syncMock });

    await reconcileRcEntitlement(deps);

    expect(callOrder).toEqual(["restorePurchases", "syncFn"]);
  });

  it("calls refreshUsers with the user's id so the Pro ring updates", async () => {
    getCustomerInfo.mockResolvedValue(customerInfoWith(true));
    restorePurchases.mockResolvedValue(customerInfoWith(true));
    const deps = makeDeps({ userId: "u42", serverIsPro: false });

    await reconcileRcEntitlement(deps);

    expect(deps.refreshUsers).toHaveBeenCalledTimes(1);
    expect(deps.refreshUsers).toHaveBeenCalledWith(["u42"]);
  });

  it("passes the auth token to fetchFn and syncFn", async () => {
    getCustomerInfo.mockResolvedValue(customerInfoWith(true));
    restorePurchases.mockResolvedValue(customerInfoWith(true));
    const deps = makeDeps({ authToken: "my-token", serverIsPro: false });

    await reconcileRcEntitlement(deps);

    // fetchFn called for /api/subscription and should carry the auth header
    const [, fetchOpts] = (deps.fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((fetchOpts.headers as Record<string, string>)?.Authorization).toBe(
      "Bearer my-token",
    );

    // syncFn should receive the same token
    expect(deps.syncFn).toHaveBeenCalledWith("my-token");
  });
});

// ---------------------------------------------------------------------------
// Case 2 — RC inactive, server true (lapsed / refunded)
// ---------------------------------------------------------------------------
describe("reconcileRcEntitlement: RC=false, server=true (lapsed/refunded)", () => {
  it("does NOT call restorePurchases", async () => {
    getCustomerInfo.mockResolvedValue(customerInfoWith(false));
    const deps = makeDeps({ serverIsPro: true });

    await reconcileRcEntitlement(deps);

    expect(restorePurchases).not.toHaveBeenCalled();
  });

  it("still calls syncFn to let the server correct the stale Pro flag", async () => {
    getCustomerInfo.mockResolvedValue(customerInfoWith(false));
    const deps = makeDeps({ serverIsPro: true });

    await reconcileRcEntitlement(deps);

    expect(deps.syncFn).toHaveBeenCalledTimes(1);
  });

  it("does NOT call refreshUsers (user is losing Pro, not gaining)", async () => {
    getCustomerInfo.mockResolvedValue(customerInfoWith(false));
    const deps = makeDeps({ serverIsPro: true });

    await reconcileRcEntitlement(deps);

    expect(deps.refreshUsers).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Steady-state — RC and server already agree
// ---------------------------------------------------------------------------
describe("reconcileRcEntitlement: RC and server agree (no action needed)", () => {
  it("skips restore and sync when both say Pro", async () => {
    getCustomerInfo.mockResolvedValue(customerInfoWith(true));
    const deps = makeDeps({ serverIsPro: true });

    await reconcileRcEntitlement(deps);

    expect(restorePurchases).not.toHaveBeenCalled();
    expect(deps.syncFn).not.toHaveBeenCalled();
    expect(deps.refreshUsers).not.toHaveBeenCalled();
  });

  it("skips restore and sync when both say not Pro", async () => {
    getCustomerInfo.mockResolvedValue(customerInfoWith(false));
    const deps = makeDeps({ serverIsPro: false });

    await reconcileRcEntitlement(deps);

    expect(restorePurchases).not.toHaveBeenCalled();
    expect(deps.syncFn).not.toHaveBeenCalled();
    expect(deps.refreshUsers).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Edge cases — graceful degradation
// ---------------------------------------------------------------------------
describe("reconcileRcEntitlement: edge cases", () => {
  it("bails out early when /api/subscription returns a non-OK response", async () => {
    getCustomerInfo.mockResolvedValue(customerInfoWith(true));
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({}, false /* not ok */));
    const deps = makeDeps({ serverIsPro: false, fetchMock });

    await reconcileRcEntitlement(deps);

    expect(restorePurchases).not.toHaveBeenCalled();
    expect(deps.syncFn).not.toHaveBeenCalled();
    expect(deps.refreshUsers).not.toHaveBeenCalled();
  });

  it("bails out before fetching when the SDK is unavailable (web platform)", async () => {
    platform.OS = "web" as typeof platform.OS;
    // Even if getCustomerInfo were registered, getLocalEntitlementActive returns
    // null on web — so fetchFn must never be reached.
    const deps = makeDeps({ serverIsPro: false });

    await reconcileRcEntitlement(deps);

    expect((deps.fetchFn as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(restorePurchases).not.toHaveBeenCalled();
    expect(deps.syncFn).not.toHaveBeenCalled();
    expect(deps.refreshUsers).not.toHaveBeenCalled();
  });

  it("does not throw when restore fails — best-effort error swallowing", async () => {
    getCustomerInfo.mockResolvedValue(customerInfoWith(true));
    // restoreSquadzPlus catches internally and returns { ok: false }; the outer
    // try/catch in reconcileRcEntitlement must not propagate any error.
    restorePurchases.mockRejectedValue(new Error("Store error"));
    const deps = makeDeps({ serverIsPro: false });

    await expect(reconcileRcEntitlement(deps)).resolves.not.toThrow();
  });

  it("does not throw when fetchFn throws — network failure on launch", async () => {
    getCustomerInfo.mockResolvedValue(customerInfoWith(true));
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network error"));
    const deps = makeDeps({ serverIsPro: false, fetchMock });

    await expect(reconcileRcEntitlement(deps)).resolves.not.toThrow();
  });
});
