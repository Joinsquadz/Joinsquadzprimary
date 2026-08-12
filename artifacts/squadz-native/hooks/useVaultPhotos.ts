import { useCallback, useEffect, useState } from "react";

import { API_BASE, buildAuthHeaders } from "@/lib/api";

/**
 * Shared fetcher for the personal photo vault (`/api/vault/photos`). Both the
 * Photos tab and the full vault screen render this same endpoint, so the fetch
 * + auth-header + requiresPro bookkeeping lives here once instead of being
 * copied into each screen.
 *
 * This hook deliberately does NOT own an entitlement flag. It used to expose its
 * own `isPro`, which made it one more competing source of truth; callers read
 * `isPro` from AppContext instead. `requiresPro` stays because it is a property
 * of THIS response (the roll-up was gated), not of the user.
 *
 * The item type is a generic because callers type the row differently (the
 * Photos tab tracks `locked`, the vault screen tracks favorites/hearts) — the
 * server payload is the same shape either way.
 */
export type UseVaultPhotosOptions = {
  authToken: string | null;
  /** Scope the roll-up to a single squad's shared vault. */
  squadId?: string | null;
  /** Scope the roll-up to a single event/trip. */
  eventId?: string | null;
  /** When false the hook stays idle (no fetch, no auto-refetch). */
  enabled?: boolean;
  /** Fetch automatically on mount / when inputs change (default true). */
  autoFetch?: boolean;
};

export function useVaultPhotos<T = unknown>(opts: UseVaultPhotosOptions) {
  const { authToken, squadId, eventId, enabled = true, autoFetch = true } = opts;

  const [photos, setPhotos] = useState<T[]>([]);
  const [requiresPro, setRequiresPro] = useState(false);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!enabled) return;
    const params = new URLSearchParams();
    if (squadId) params.set("squadId", squadId);
    else if (eventId) params.set("eventId", eventId);
    const qs = params.toString();

    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/vault/photos${qs ? `?${qs}` : ""}`,
        { headers: buildAuthHeaders(authToken) },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        photos?: T[];
        requiresPro?: boolean;
      };
      setPhotos(data.photos ?? []);
      setRequiresPro(!!data.requiresPro);
    } catch {
      // network hiccup — leave the last-known photos in place.
    } finally {
      setLoading(false);
    }
  }, [authToken, squadId, eventId, enabled]);

  useEffect(() => {
    if (autoFetch && enabled) void refetch();
  }, [autoFetch, enabled, refetch]);

  return { photos, setPhotos, requiresPro, loading, refetch };
}
