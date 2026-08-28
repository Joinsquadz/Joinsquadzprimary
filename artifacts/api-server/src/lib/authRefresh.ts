type SupabaseRefreshError = {
  status?: unknown;
  code?: unknown;
  name?: unknown;
};

const DEFINITIVE_REFRESH_CODES = new Set([
  "bad_jwt",
  "refresh_token_already_used",
  "refresh_token_not_found",
  "session_not_found",
]);

/**
 * Supabase returns an error object for both invalid credentials and provider
 * incidents. Only credential-shaped 4xx failures are allowed to sign a user
 * out; throttling, fetch failures, and 5xx responses remain retryable.
 */
export function classifySupabaseRefreshError(
  error: unknown,
): "invalid" | "transient" {
  if (!error || typeof error !== "object") return "transient";
  const candidate = error as SupabaseRefreshError;
  if (
    typeof candidate.code === "string" &&
    DEFINITIVE_REFRESH_CODES.has(candidate.code)
  ) {
    return "invalid";
  }
  if (
    typeof candidate.status === "number" &&
    (candidate.status === 400 || candidate.status === 401 || candidate.status === 403)
  ) {
    return "invalid";
  }
  return "transient";
}