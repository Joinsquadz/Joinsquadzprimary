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
 * Dependencies are injected so the caller (or a test) can supply mocks:
 *   - fetchFn    — defaults to global fetch; tests pass a vi.fn()
 *   - syncFn     — defaults to syncIapEntitlement; tests pass a vi.fn()
 *   - refreshFn  — the refreshUsers callback from useUserCache
 */

import { getLocalEntitlementActive, restoreSquadzPlus, configureRevenueCat } from "@/lib/revenuecat";
import { API_BASE, buildAuthHeaders, syncIapEntitlement } from "@/lib/api";

export type ReconcileDeps = {
  /** Auth token for the signed-in user. */
  authToken: string | null;
  /** Squadz user id. */
  userId: string;
  /** Callback to bust the user cache so the Pro ring refreshes. */
  refreshUsers: (ids: string[]) => void;
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
  fetchFn = fetch,
  syncFn = syncIapEntitlement,
}: ReconcileDeps): Promise<void> {
  await configureRevenueCat(userId);
  try {
    const local = await getLocalEntitlementActive();
    if (local === null) return; // web or SDK unavailable — nothing to do

    const r = await fetchFn(`${API_BASE}/api/subscription`, {
      headers: buildAuthHeaders(authToken),
      credentials: "include",
    });
    if (!r.ok) return;

    const d = (await r.json()) as { isPro?: boolean };
    const serverPro = !!d.isPro;

    if (local && !serverPro) {
      // RC says entitled but server doesn't know — restore purchases
      // (re-validates receipt with the store) then sync the server.
      await restoreSquadzPlus();
      await syncFn(authToken);
      // Bust the user cache so the Pro ring shows without a manual refresh.
      refreshUsers([userId]);
    } else if (!local && serverPro) {
      // Server thinks Pro but RC doesn't — sync to let the server correct.
      void syncFn(authToken);
    }
  } catch {
    // Best-effort reconciliation only — never block launch on billing.
  }
}
