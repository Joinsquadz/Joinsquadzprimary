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
