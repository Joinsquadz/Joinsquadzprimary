import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Resolves the API base URL for the current environment.
 *
 * In production native builds: set EXPO_PUBLIC_API_URL in the build environment.
 * In Expo Go / development: REPLIT_DEV_DOMAIN is injected via app.config.js extra
 * (`extra.apiBase`), so this returns the ABSOLUTE main dev domain.
 * In Expo web preview: that means /api calls are cross-origin (the preview is
 * served from $REPLIT_EXPO_DEV_DOMAIN, which bypasses the shared proxy), so the
 * api-server CORS allowlist must include the Expo origin. The Platform.OS==="web"
 * relative-URL fallback below only applies when no apiBase/EXPO_PUBLIC_API_URL is set.
 */
export function resolveApiBase(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  const extra = Constants.expoConfig?.extra as Record<string, string> | undefined;
  if (extra?.apiBase) return extra.apiBase;
  if (Platform.OS === "web") return "";
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
