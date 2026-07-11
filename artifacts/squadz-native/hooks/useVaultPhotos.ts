import { useCallback, useEffect, useState } from "react";

import { API_BASE, buildAuthHeaders } from "@/lib/api";

/**
 * Shared fetcher for the personal photo vault (`/api/vault/photos`). Both the
 * Photos tab and the full vault screen render this same endpoint, so the fetch
 * + auth-header + isPro/requiresPro bookkeeping lives here once instead of being
 * copied into each screen.
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
  const [isPro, setIsPro] = useState<boolean | null>(null);
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
      if (!res.ok) {
        // Resolve isPro out of its initial null so callers gating a loading
        // spinner on `isPro === null` don't hang forever on a failed request.
        setIsPro((prev) => (prev === null ? false : prev));
        return;
      }
      const data = (await res.json()) as {
        photos?: T[];
        isPro?: boolean;
        requiresPro?: boolean;
      };
      setPhotos(data.photos ?? []);
      if (data.isPro !== undefined) setIsPro(!!data.isPro);
      setRequiresPro(!!data.requiresPro);
    } catch {
      // network hiccup — leave the last-known photos in place, but un-stick the
      // loading gate if we never resolved a subscription state.
      setIsPro((prev) => (prev === null ? false : prev));
    } finally {
      setLoading(false);
    }
  }, [authToken, squadId, eventId, enabled]);

  useEffect(() => {
    if (autoFetch && enabled) void refetch();
  }, [autoFetch, enabled, refetch]);

  return { photos, setPhotos, isPro, setIsPro, requiresPro, loading, refetch };
}
