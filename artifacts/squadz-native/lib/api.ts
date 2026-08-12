import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Resolves the API base URL for the current environment.
 *
 * In production native builds: set EXPO_PUBLIC_API_URL in the build environment.
 * In Expo Go / native development: REPLIT_DEV_DOMAIN is injected via
 * app.config.js extra (`extra.apiBase`), so this returns the ABSOLUTE main dev
 * domain (native bundles run outside any proxy and need an absolute URL).
 *
 * On WEB we return "" (same-origin, relative `/api/...`). The app is served from
 * $REPLIT_EXPO_DEV_DOMAIN (dev) or behind the shared proxy (prod), and `/api` is
 * routed to the api-server from that SAME origin — in dev by the Metro proxy
 * middleware in `metro.config.js`, in prod by the shared reverse proxy. Using a
 * relative base means both the normal preview browser AND the headless UI-test
 * (Playwright) browser can reach the API without any cross-origin hop, which the
 * test browser cannot make to the main dev domain. An explicit
 * EXPO_PUBLIC_API_URL still wins if set.
 */
export function resolveApiBase(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  if (Platform.OS === "web") return "";
  const extra = Constants.expoConfig?.extra as Record<string, string> | undefined;
  if (extra?.apiBase) return extra.apiBase;
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) return `https://${devDomain}`;
  return "";
}

/** Resolved API base URL for the current environment. */
export const API_BASE = resolveApiBase();

/**
 * Resolves an upload `objectPath` returned by POST /storage/uploads/request-url
 * into a URL the client can load.
 *
 * - Public uploads (e.g. profile avatars) come back as a full Supabase public
 *   URL (`https://...`) and must be used verbatim.
 * - Protected uploads come back as a relative `/objects/...` path served through
 *   the auth-gated `/api/storage` proxy.
 *
 * Prepending the proxy prefix to a full URL yields a broken link, so callers
 * must branch on whether the path is already absolute.
 */
export function resolveUploadedUrl(objectPath: string): string {
  return /^https?:\/\//i.test(objectPath) ? objectPath : `/api/storage${objectPath}`;
}

/**
 * Builds auth headers for authenticated API calls.
 * Returns a Bearer Authorization header when a token is present, otherwise
 * an empty object. The result is compatible with both `HeadersInit` and
 * `Record<string, string>`.
 */
export function buildAuthHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Wraps `fetch` with an automatic abort after `timeoutMs` (default 30 s).
 * Callers that supply their own `signal` retain full control — no extra timeout
 * is layered on top of theirs. External storage PUT requests (which can be
 * large) should pass a longer timeout or their own signal.
 */
export function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 30_000,
): Promise<Response> {
  if (init?.signal) return fetch(url, init!);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * Maps an HTTP status code to a short user-friendly message.
 * 429 gets a rate-limit hint; 5xx get a generic server-error hint.
 * Never exposes raw server-supplied text to the user.
 */
export function friendlyHttpError(status: number): string {
  if (status === 429) return "Too many requests — please wait a moment and try again.";
  if (status >= 500) return "Server error — please try again shortly.";
  return "Something went wrong. Please try again.";
}

/**
 * Asks the API server to send a manual organizer reminder for the given event.
 *
 * - type "general"  → notifies all going + maybe RSVPs (excludes sender).
 * - type "rsvp"     → notifies squad members + invited friends who haven't responded.
 *
 * Each type has an independent 1-hour cooldown enforced server-side.
 * Returns `{ ok: true }` on success, or `{ ok: false, status, retryAfterMs?, error? }` on failure.
 */
export async function sendManualReminder(
  eventId: string,
  type: "general" | "rsvp",
  token: string | null,
): Promise<{ ok: true; sent?: number } | { ok: false; status: number; retryAfterMs?: number; error?: string }> {
  const res = await fetch(`${API_BASE}/api/events/${eventId}/remind`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(token),
    },
    body: JSON.stringify({ type }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      retryAfterMs: typeof data.retryAfterMs === "number" ? data.retryAfterMs : undefined,
      error: typeof data.error === "string" ? data.error : undefined,
    };
  }
  return { ok: true, sent: typeof data.sent === "number" ? data.sent : undefined };
}

/** Entitlement as resolved by the server (`/api/iap/sync`, `/api/subscription`). */
export type ServerEntitlement = { entitled: boolean; tier: "founding" | "standard" | "none" };

export type SyncIapResult =
  /** The server reached RevenueCat and returned an authoritative entitlement. */
  | { ok: true; entitlement: ServerEntitlement }
  /**
   * The sync did not produce an authoritative answer. `retryable` distinguishes a
   * transient fault (network blip, 5xx, RevenueCat unreachable) from a permanent
   * one (401/403/404) so callers can bound their retries instead of hammering a
   * request that will never succeed. A failure here must NEVER be read as
   * "not entitled" — it carries no entitlement at all.
   */
  | { ok: false; retryable: boolean; status?: number };

/**
 * B4: Reconcile the server-side Squadz+ entitlement with the live RevenueCat
 * subscriber state. Called after purchase/restore and on launch when the
 * on-device entitlement disagrees with the server. Idempotent.
 *
 * Returns the resolved entitlement so a caller that just completed a purchase can
 * adopt server truth directly rather than polling /api/subscription until the
 * webhook lands.
 */
export async function syncIapEntitlement(token: string | null): Promise<SyncIapResult> {
  try {
    const res = await fetch(`${API_BASE}/api/iap/sync`, {
      method: "POST",
      headers: buildAuthHeaders(token),
      credentials: "include",
    });
    if (!res.ok) {
      // 4xx (bad/expired token, route missing) will fail identically on retry;
      // 5xx and 503 "not configured" are worth a bounded retry.
      return { ok: false, retryable: res.status >= 500, status: res.status };
    }
    const data = (await res.json()) as { isSquadzPlus?: boolean; isPro?: boolean; tier?: string };
    const entitled = !!(data.isSquadzPlus ?? data.isPro);
    const tier =
      data.tier === "founding" || data.tier === "standard" || data.tier === "none"
        ? data.tier
        : // Older server build without `tier`: entitled users read as standard so
          // the badge degrades gracefully instead of blocking the entitlement.
          entitled
          ? "standard"
          : "none";
    return { ok: true, entitlement: { entitled, tier: entitled ? tier : "none" } };
  } catch {
    return { ok: false, retryable: true };
  }
}
