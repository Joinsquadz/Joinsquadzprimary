/**
 * Entitlement-change invalidation.
 *
 * `lib/entitlement.ts` decides WHAT the current entitlement is. This module
 * decides what has to be re-read WHEN it changes, and is the one place that
 * knows the answer.
 *
 * The problem it solves: unlocking (or losing) SquadZ+ silently invalidates
 * server-computed values that are cached in screen-local state — the free plan
 * counter on the create screen, the squad cap, whether the vault roll-up is
 * gated, and the paywall copy that quotes those limits. Each surface used to
 * decide for itself when to refetch, so a purchase made on the Photos tab left
 * "3/3 free plans used" sitting on the create screen until an app restart, and a
 * lapse left an unlocked vault on screen.
 *
 * Deliberately free of React and react-native imports so the decision rule is
 * unit-testable under plain node.
 */

import type { Entitlement } from "@/lib/entitlement";

/**
 * The kinds of derived state that go stale when entitlement changes. Listed
 * explicitly (rather than "invalidate everything") so a new gated surface has
 * an obvious place to declare itself.
 */
export type EntitlementInvalidationTarget =
  /** GET /api/events/count — free plan allowance and next-free-slot date. */
  | "plan-limit"
  /** Squad cap: how many squads a free account may own/join. */
  | "squad-limit"
  /** Vault + Photos roll-up gating (`requiresPro`) and favorites access. */
  | "vault-access"
  /** Paywall / upgrade copy, which quotes the limits above. */
  | "paywall-copy";

export const ALL_ENTITLEMENT_TARGETS: readonly EntitlementInvalidationTarget[] = [
  "plan-limit",
  "squad-limit",
  "vault-access",
  "paywall-copy",
];

/**
 * Should a transition from `prev` to `next` invalidate tier-sensitive caches?
 *
 * True only when the ACCESS ANSWER changes:
 *   - unresolved → resolved: the first real answer of the session. Screens that
 *     rendered against a spinner (or a stale mount) need to read again.
 *   - entitled flips: the unlock/lock event itself.
 *   - tier changes while entitled: founding vs standard drives paywall and
 *     badge copy even though access is unchanged.
 *
 * False for same-value re-reports, which are frequent: the RevenueCat listener,
 * app-open reconciliation, and every vault response all publish an entitlement,
 * and treating each as a change would turn foregrounding the app into a refetch
 * storm. Notably a `source` change alone (server confirming what the store
 * already said) is NOT an invalidation.
 */
export function shouldInvalidateForEntitlement(
  prev: Entitlement,
  next: Entitlement,
): boolean {
  if (!next.resolved) return false;
  if (!prev.resolved) return true;
  if (prev.entitled !== next.entitled) return true;
  return prev.entitled && prev.tier !== next.tier;
}

export type EntitlementInvalidationListener = (
  targets: readonly EntitlementInvalidationTarget[],
) => void;

/**
 * Minimal subscribe/notify registry.
 *
 * Screens register the refetch they own; AppContext notifies once per real
 * entitlement change. Listener errors are swallowed on purpose — one screen's
 * failed refetch must not stop the others from refreshing.
 */
export function createEntitlementInvalidator() {
  const listeners = new Set<EntitlementInvalidationListener>();

  return {
    subscribe(listener: EntitlementInvalidationListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify(targets: readonly EntitlementInvalidationTarget[] = ALL_ENTITLEMENT_TARGETS): void {
      for (const listener of [...listeners]) {
        try {
          listener(targets);
        } catch {
          // A broken subscriber must not block the rest.
        }
      }
    },
    get size(): number {
      return listeners.size;
    },
  };
}

export type EntitlementInvalidator = ReturnType<typeof createEntitlementInvalidator>;
