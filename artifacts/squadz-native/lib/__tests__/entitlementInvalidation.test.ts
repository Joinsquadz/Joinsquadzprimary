/**
 * The entitlement-change invalidation boundary (lib/entitlementInvalidation.ts).
 *
 * Two properties matter and pull in opposite directions:
 *   1. every REAL change must reach every tier-sensitive surface, even ones the
 *      user isn't looking at, or a purchase made on the Photos tab leaves a
 *      stale "3/3 free plans used" on the create screen;
 *   2. the many same-value re-reports (RC listener, launch reconciliation, each
 *      vault response) must NOT, or foregrounding the app becomes a refetch
 *      storm against the cap endpoints.
 */
import { describe, it, expect, vi } from "vitest";

import {
  ALL_ENTITLEMENT_TARGETS,
  createEntitlementInvalidator,
  shouldInvalidateForEntitlement,
  type EntitlementInvalidationTarget,
} from "@/lib/entitlementInvalidation";
import { UNRESOLVED_ENTITLEMENT, type Entitlement } from "@/lib/entitlement";

const pro = (
  tier: "founding" | "standard" = "standard",
  source: "server" | "revenuecat" | "optimistic" = "server",
): Entitlement => ({ resolved: true, entitled: true, tier, source });

const free = (
  source: "server" | "revenuecat" | "optimistic" = "server",
): Entitlement => ({ resolved: true, entitled: false, tier: "none", source });

describe("shouldInvalidateForEntitlement — real changes", () => {
  it("invalidates on the first resolved reading of the session", () => {
    expect(shouldInvalidateForEntitlement(UNRESOLVED_ENTITLEMENT, free())).toBe(true);
    expect(shouldInvalidateForEntitlement(UNRESOLVED_ENTITLEMENT, pro())).toBe(true);
  });

  it("invalidates when the user unlocks SquadZ+", () => {
    expect(shouldInvalidateForEntitlement(free(), pro())).toBe(true);
  });

  it("invalidates when the entitlement lapses", () => {
    expect(shouldInvalidateForEntitlement(pro(), free("revenuecat"))).toBe(true);
  });

  it("invalidates on a tier change while still entitled (paywall/badge copy)", () => {
    expect(shouldInvalidateForEntitlement(pro("standard"), pro("founding"))).toBe(true);
  });
});

describe("shouldInvalidateForEntitlement — noise that must be ignored", () => {
  it("ignores a same-value re-report", () => {
    expect(shouldInvalidateForEntitlement(pro(), pro())).toBe(false);
    expect(shouldInvalidateForEntitlement(free(), free())).toBe(false);
  });

  it("ignores a source change alone (server confirming the store's answer)", () => {
    // This is the single most common publish in the app: the optimistic reading
    // taken at purchase, later confirmed by /api/iap/sync. Nothing to re-read.
    expect(shouldInvalidateForEntitlement(pro("standard", "optimistic"), pro("standard", "server"))).toBe(
      false,
    );
  });

  it("ignores a tier difference while NOT entitled", () => {
    // 'none' is the only tier a non-entitled user can have; treating variations
    // as a change would fire on every free-user re-report.
    const freeish: Entitlement = { resolved: true, entitled: false, tier: "none", source: "revenuecat" };
    expect(shouldInvalidateForEntitlement(free(), freeish)).toBe(false);
  });

  it("never invalidates towards an unresolved state", () => {
    expect(shouldInvalidateForEntitlement(pro(), UNRESOLVED_ENTITLEMENT)).toBe(false);
  });
});

describe("createEntitlementInvalidator", () => {
  it("notifies every subscriber, so an unmounted-then-remounted screen isn't missed", () => {
    const invalidator = createEntitlementInvalidator();
    const a = vi.fn();
    const b = vi.fn();
    invalidator.subscribe(a);
    invalidator.subscribe(b);

    invalidator.notify();

    expect(a).toHaveBeenCalledWith(ALL_ENTITLEMENT_TARGETS);
    expect(b).toHaveBeenCalledWith(ALL_ENTITLEMENT_TARGETS);
  });

  it("stops notifying after unsubscribe", () => {
    const invalidator = createEntitlementInvalidator();
    const listener = vi.fn();
    const off = invalidator.subscribe(listener);

    off();
    invalidator.notify();

    expect(listener).not.toHaveBeenCalled();
    expect(invalidator.size).toBe(0);
  });

  it("passes a narrowed target list through untouched", () => {
    const invalidator = createEntitlementInvalidator();
    const listener = vi.fn();
    invalidator.subscribe(listener);
    const targets: EntitlementInvalidationTarget[] = ["vault-access"];

    invalidator.notify(targets);

    expect(listener).toHaveBeenCalledWith(targets);
  });

  it("keeps notifying the remaining subscribers when one throws", () => {
    // A failed refetch on one screen must not silently leave every other gated
    // surface stale — that failure mode is exactly what this boundary replaced.
    const invalidator = createEntitlementInvalidator();
    const broken = vi.fn().mockImplementation(() => {
      throw new Error("refetch blew up");
    });
    const healthy = vi.fn();
    invalidator.subscribe(broken);
    invalidator.subscribe(healthy);

    expect(() => invalidator.notify()).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it("covers plan caps, squad caps, vault access and paywall copy", () => {
    // Pinned so a future gated surface has to consciously join the boundary
    // rather than quietly inventing its own isPro watcher.
    expect([...ALL_ENTITLEMENT_TARGETS].sort()).toEqual([
      "paywall-copy",
      "plan-limit",
      "squad-limit",
      "vault-access",
    ]);
  });
});
