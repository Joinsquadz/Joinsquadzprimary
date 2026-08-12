/**
 * Background revocation → next app-open re-lock.
 *
 * The scenario no other test covers: a subscriber's entitlement ends while the
 * app is NOT running (annual expiry, refund, billing failure, or a cancellation
 * made in the App Store). No RevenueCat listener is registered when the process
 * is dead, so nothing observes the change — the only chance to notice is launch
 * reconciliation. If that path fails to re-lock, the user keeps SquadZ+ features
 * indefinitely, because every later reading is a same-value re-report of a stale
 * positive.
 *
 * These tests drive the REAL launch path (`reconcileRcEntitlement`) into the
 * REAL precedence rules (`applyEntitlement`) and the REAL invalidation rule
 * (`shouldInvalidateForEntitlement`), so a regression in any one of the three
 * fails here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { platform, getCustomerInfo, restorePurchases } = vi.hoisted(() => ({
  platform: { OS: "ios" as "ios" | "android" | "web" },
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

vi.mock("@/lib/api", () => ({
  API_BASE: "",
  buildAuthHeaders: (token: string | null) =>
    token ? { Authorization: `Bearer ${token}` } : {},
  syncIapEntitlement: vi.fn(),
}));

import { RC_ENTITLEMENT_ID, configureRevenueCat } from "@/lib/revenuecat";
import { reconcileRcEntitlement, type ReconcileDeps } from "@/lib/rcReconcile";
import {
  applyEntitlement,
  type Entitlement,
  type ResolvedEntitlement,
} from "@/lib/entitlement";
import { shouldInvalidateForEntitlement } from "@/lib/entitlementInvalidation";

/** Customer info for an ACTIVE entitlement on the given product. */
function activeInfo(productIdentifier = "com.squadz.app.squadzplus.standard.annual") {
  return { entitlements: { active: { [RC_ENTITLEMENT_ID]: { productIdentifier } } } };
}
/** Customer info after the subscription lapsed — nothing active. */
function lapsedInfo() {
  return { entitlements: { active: {} } };
}

function response(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

/**
 * A miniature stand-in for the AppContext entitlement store: the same
 * `applyEntitlement` reducer plus the same invalidation predicate, so the test
 * exercises the production rules rather than re-implementing them.
 */
function makeStore(initial: Entitlement) {
  let current = initial;
  const invalidations: number[] = [];
  return {
    get value() {
      return current;
    },
    get invalidationCount() {
      return invalidations.length;
    },
    set(next: ResolvedEntitlement) {
      const applied = applyEntitlement(current, next);
      if (shouldInvalidateForEntitlement(current, applied)) invalidations.push(1);
      current = applied;
    },
  };
}

/** The entitlement the store holds at launch, carried over from last session. */
const STALE_ACTIVE: ResolvedEntitlement = {
  resolved: true,
  entitled: true,
  tier: "standard",
  source: "revenuecat",
};

beforeEach(async () => {
  vi.clearAllMocks();
  platform.OS = "ios";
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "appl_test";
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = "goog_test";
  await configureRevenueCat("u1");
});

describe("expiry while backgrounded → next app-open re-locks", () => {
  it("re-locks when BOTH the store and the server report the lapse", async () => {
    // Launch after the subscription ended: RC has nothing active, and the
    // webhook already cleared the server flag.
    getCustomerInfo.mockResolvedValue(lapsedInfo());
    const store = makeStore(STALE_ACTIVE);

    await reconcileRcEntitlement({
      authToken: "tok",
      userId: "u1",
      refreshUsers: vi.fn(),
      onEntitlement: (next: ResolvedEntitlement) => store.set(next),
      fetchFn: vi.fn().mockResolvedValue(response({ isPro: false })),
      syncFn: vi.fn(),
    } as unknown as ReconcileDeps);

    expect(store.value).toMatchObject({ resolved: true, entitled: false, tier: "none" });
  });

  it("re-locks on the STORE's word even while the server still says Pro", async () => {
    // Refund / billing failure the webhook hasn't reflected yet. The store is
    // authoritative about the ABSENCE of a purchase, so a stale server "yes"
    // must not keep the app unlocked.
    getCustomerInfo.mockResolvedValue(lapsedInfo());
    const syncFn = vi.fn();
    const store = makeStore(STALE_ACTIVE);

    await reconcileRcEntitlement({
      authToken: "tok",
      userId: "u1",
      refreshUsers: vi.fn(),
      onEntitlement: (next: ResolvedEntitlement) => store.set(next),
      fetchFn: vi.fn().mockResolvedValue(response({ isPro: true })),
      syncFn,
    } as unknown as ReconcileDeps);

    expect(store.value).toMatchObject({ entitled: false, tier: "none", source: "revenuecat" });
    // …and the server is told to correct its own record.
    expect(syncFn).toHaveBeenCalledTimes(1);
  });

  it("does not restore purchases when the entitlement simply lapsed", async () => {
    // Restoring here would be pointless (there is nothing to restore) and would
    // put a store round-trip on the launch path for every lapsed user.
    getCustomerInfo.mockResolvedValue(lapsedInfo());

    await reconcileRcEntitlement({
      authToken: "tok",
      userId: "u1",
      refreshUsers: vi.fn(),
      onEntitlement: vi.fn(),
      fetchFn: vi.fn().mockResolvedValue(response({ isPro: true })),
      syncFn: vi.fn(),
    } as unknown as ReconcileDeps);

    expect(restorePurchases).not.toHaveBeenCalled();
  });

  it("fires exactly ONE invalidation for the lock transition", async () => {
    // Reconciliation publishes more than once (device reading, then the server
    // reading). Gated surfaces must be told to re-read once, not per publish.
    getCustomerInfo.mockResolvedValue(lapsedInfo());
    const store = makeStore(STALE_ACTIVE);

    await reconcileRcEntitlement({
      authToken: "tok",
      userId: "u1",
      refreshUsers: vi.fn(),
      onEntitlement: (next: ResolvedEntitlement) => store.set(next),
      fetchFn: vi.fn().mockResolvedValue(response({ isPro: false })),
      syncFn: vi.fn(),
    } as unknown as ReconcileDeps);

    expect(store.invalidationCount).toBe(1);
  });

  it("leaves a still-valid subscription untouched and raises no invalidation", async () => {
    // The control case: nothing changed over the background period, so the
    // launch must not churn caches or flicker the paywall.
    getCustomerInfo.mockResolvedValue(activeInfo());
    const store = makeStore(STALE_ACTIVE);

    await reconcileRcEntitlement({
      authToken: "tok",
      userId: "u1",
      refreshUsers: vi.fn(),
      onEntitlement: (next: ResolvedEntitlement) => store.set(next),
      fetchFn: vi.fn().mockResolvedValue(response({ isPro: true, tier: "standard" })),
      syncFn: vi.fn(),
    } as unknown as ReconcileDeps);

    expect(store.value).toMatchObject({ entitled: true, tier: "standard" });
    expect(store.invalidationCount).toBe(0);
  });

  it("keeps the stale positive when the store is unreachable at launch", async () => {
    // getCustomerInfo throwing (offline cold start) is NOT evidence of a lapse.
    // Locking a paying subscriber out because their plane had no wifi would be
    // far worse than a day of unearned access.
    getCustomerInfo.mockRejectedValue(new Error("offline"));
    const store = makeStore(STALE_ACTIVE);

    await reconcileRcEntitlement({
      authToken: "tok",
      userId: "u1",
      refreshUsers: vi.fn(),
      onEntitlement: (next: ResolvedEntitlement) => store.set(next),
      fetchFn: vi.fn().mockResolvedValue(response({ isPro: false })),
      syncFn: vi.fn(),
    } as unknown as ReconcileDeps);

    expect(store.value).toMatchObject({ entitled: true });
    expect(store.invalidationCount).toBe(0);
  });

  it("re-locks a user whose entitlement was gone before this device ever saw it", async () => {
    // Fresh process with an unresolved store (the real cold-start shape): the
    // first reading of the session is the lapse itself.
    getCustomerInfo.mockResolvedValue(lapsedInfo());
    const store = makeStore({ resolved: false, entitled: false, tier: "none" });

    await reconcileRcEntitlement({
      authToken: "tok",
      userId: "u1",
      refreshUsers: vi.fn(),
      onEntitlement: (next: ResolvedEntitlement) => store.set(next),
      fetchFn: vi.fn().mockResolvedValue(response({ isPro: false })),
      syncFn: vi.fn(),
    } as unknown as ReconcileDeps);

    expect(store.value).toMatchObject({ resolved: true, entitled: false });
    // Unresolved → resolved is itself an invalidation: surfaces that rendered a
    // spinner now have a real answer to render against.
    expect(store.invalidationCount).toBe(1);
  });
});
