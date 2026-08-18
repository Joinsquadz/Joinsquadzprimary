/**
 * A 401 on a protected request only proves a session is invalid after the app
 * has already established one. Before startup validation completes, the same
 * status can be the normal token-restoration race and must keep retrying.
 */
export function shouldInvalidateConfirmedSession(args: {
  path: string;
  isSessionValidated: boolean;
  hasSessionToken: boolean;
}): boolean {
  return (
    !args.path.startsWith("/api/auth/") &&
    args.isSessionValidated &&
    args.hasSessionToken
  );
}