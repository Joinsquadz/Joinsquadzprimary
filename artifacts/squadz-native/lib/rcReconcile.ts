/**
 * reconcileRcEntitlement
 *
 * On launch, reconcile the on-device RevenueCat entitlement with the server's
 * Pro record. Extracted from RevenueCatConnector (_layout.tsx) so it can be
 * imported and integration-tested without a React renderer.
 *
 * Case 1 — RC active, server false (reinstall / new device):
 *   Call restorePurchases() first so the store re-validates the receipt,
 *   then POST /api/iap/sync so the server flips is_squadz_plus. Finally
 *   refreshUsers() so the gold Pro ring appears immediately.
 *
 * Case 2 — RC inactive, server true (lapsed / refunded):
 *   Skip restore (nothing to restore), just sync to let the server clear
 *   the stale Pro flag. No cache bust needed (user is losing Pro, not gaining).
 *
 * In BOTH cases — and in the agreeing case — the entitlement we resolve is
 * published to the global store via `onEntitlement`. Reconciliation used to only
 * write the server and the user cache, so AppContext kept whatever it had read
 * at startup and gated screens stayed stale until an app restart.
 *
 * Ordering matters: the local (store) reading is published BEFORE the server is
 * consulted. `applyEntitlement` in AppContext then refuses to downgrade a
 * device-confirmed entitlement on a server "no", so a launch that races the
 * webhook can't briefly re-lock a paying subscriber.
 *
 * Dependencies are injected so the caller (or a test) can supply mocks:
 *   - fetchFn    — defaults to global fetch; tests pass a vi.fn()
 *   - syncFn     — defaults to syncIapEntitlement; tests pass a vi.fn()
 *   - refreshFn  — the refreshUsers callback from useUserCache
 */

import { getLocalEntitlement, restoreSquadzPlus, configureRevenueCat } from "@/lib/revenuecat";
import { API_BASE, buildAuthHeaders, syncIapEntitlement } from "@/lib/api";
import type { ResolvedEntitlement, EntitlementTier } from "@/context/AppContext";

export type ReconcileDeps = {
  /** Auth token for the signed-in user. */
  authToken: string | null;
  /** Squadz user id. */
  userId: string;
  /** Callback to bust the user cache so the Pro ring refreshes. */
  refreshUsers: (ids: string[]) => void;
  /**
   * Publish a resolved entitlement to the global store (AppContext.setEntitlement).
   * Optional so existing callers/tests that only care about the server side keep
   * working.
   */
  onEntitlement?: (next: ResolvedEntitlement) => void;
  /** Override fetch (injectable for tests). Defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Override syncIapEntitlement (injectable for tests). */
  syncFn?: typeof syncIapEntitlement;
};

/**
 * Run the full RC ↔ server entitlement reconciliation.
 *
 * Best-effort — never throws; billing errors must not block app launch.
 * Callers should `void` the returned promise (or `await` it in tests).
 */
export async function reconcileRcEntitlement({
  authToken,
  userId,
  refreshUsers,
  onEntitlement,
  fetchFn = fetch,
  syncFn = syncIapEntitlement,
}: ReconcileDeps): Promise<void> {
  await configureRevenueCat(userId);
  try {
    const localEnt = await getLocalEntitlement();
    if (localEnt === null) return; // web or SDK unavailable — nothing to do
    const local = localEnt.entitled;

    // Publish the device reading first. This is the value that protects a fresh
    // purchase from a server that hasn't seen the webhook yet.
    onEntitlement?.({
      resolved: true,
      entitled: local,
      tier: localEnt.tier,
      source: "revenuecat",
    });

    const r = await fetchFn(`${API_BASE}/api/subscription`, {
      headers: buildAuthHeaders(authToken),
      credentials: "include",
    });
    if (!r.ok) return;

    const d = (await r.json()) as { isPro?: boolean; tier?: string };
    const serverPro = !!d.isPro;
    const serverTier: EntitlementTier = !serverPro
      ? "none"
      : d.tier === "founding"
        ? "founding"
        : "standard";

    if (local && !serverPro) {
      // RC says entitled but server doesn't know — restore purchases
      // (re-validates receipt with the store) then sync the server.
      await restoreSquadzPlus();
      const synced = await syncFn(authToken);
      // Adopt the server's post-sync answer when it produced one; it is now the
      // authoritative record and carries the tier the receipt actually resolved to.
      if (synced && typeof synced === "object" && synced.ok) {
        onEntitlement?.({
          resolved: true,
          entitled: synced.entitlement.entitled,
          tier: synced.entitlement.tier,
          source: "server",
        });
      }
      // Bust the user cache so the Pro ring shows without a manual refresh.
      refreshUsers([userId]);
    } else if (!local && serverPro) {
      // The local CustomerInfo can be an empty/stale cache after an upgrade on
      // another device or immediately after reinstall. Reconcile against
      // RevenueCat's server record and APPLY its answer. Previously this was
      // fire-and-forget: the local "not entitled" reading stayed in AppContext
      // even when /iap/sync confirmed the active purchase, so the personal
      // vault kept showing the upgrade gate forever.
      const synced = await syncFn(authToken);
      if (synced && typeof synced === "object" && synced.ok) {
        onEntitlement?.({
          resolved: true,
          entitled: synced.entitlement.entitled,
          tier: synced.entitlement.tier,
          source: "server",
        });
      }
    } else {
      // Agreement. Publish the server reading too so the tier recorded
      // server-side (founding vs standard) wins over a local guess.
      onEntitlement?.({
        resolved: true,
        entitled: serverPro,
        tier: serverTier,
        source: "server",
      });
    }
  } catch {
    // Best-effort reconciliation only — never block launch on billing.
  }
}
