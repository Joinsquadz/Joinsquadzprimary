import * as oidc from "openid-client";
import { type Request, type Response, type NextFunction } from "express";
import type { AuthUser } from "@workspace/api-zod";
import {
  clearSession,
  getOidcConfig,
  getSessionId,
  getBearerToken,
  getSession,
  getUserFromAccessToken,
  isTokenRevoked,
  updateSession,
  deleteSession,
  withSessionRefreshLock,
  type SessionData,
} from "../lib/auth";
import { supabaseAdmin } from "../services/supabase";

declare global {
  namespace Express {
    interface User extends AuthUser {}

    interface Request {
      isAuthenticated(): this is AuthedRequest;

      user?: User | undefined;
    }

    export interface AuthedRequest {
      user: User;
    }
  }
}

type SessionRefreshOutcome =
  | { kind: "valid"; session: SessionData }
  | { kind: "invalid" }
  | { kind: "transient"; session: SessionData };

function isDefinitiveRefreshRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const oauthError = error as { name?: unknown; error?: unknown };
  return (
    oauthError.name === "ResponseBodyError" &&
    (oauthError.error === "invalid_grant" || oauthError.error === "invalid_token")
  );
}

export async function refreshIfExpired(
  sid: string,
  session: SessionData,
): Promise<SessionRefreshOutcome> {
  const now = Math.floor(Date.now() / 1000);
  if (!session.expires_at || now <= session.expires_at) {
    return { kind: "valid", session };
  }

  return withSessionRefreshLock(sid, async (executor) => {
    // Another request may have completed rotation while this one waited for the
    // advisory lock. Re-read and use the persisted pair instead of submitting
    // the stale pre-lock refresh token a second time.
    const latest = await getSession(sid, executor);
    if (!latest?.user?.id) return { kind: "invalid" };
    const lockedNow = Math.floor(Date.now() / 1000);
    if (!latest.expires_at || lockedNow <= latest.expires_at) {
      return { kind: "valid", session: latest };
    }
    if (!latest.refresh_token) {
      await deleteSession(sid, executor);
      return { kind: "invalid" };
    }

    try {
      const config = await getOidcConfig();
      const tokens = await oidc.refreshTokenGrant(
        config,
        latest.refresh_token,
      );
      const refreshed: SessionData = {
        ...latest,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? latest.refresh_token,
        expires_at: tokens.expiresIn()
          ? lockedNow + tokens.expiresIn()!
          : latest.expires_at,
      };
      await updateSession(sid, refreshed, executor);
      return { kind: "valid", session: refreshed };
    } catch (error) {
      // invalid_grant/invalid_token definitively means the refresh credential is
      // expired or revoked. Discovery outages, timeouts, and provider 5xx errors
      // do not invalidate the server-side session; preserve it and try again on a
      // later request rather than signing the user out during a network incident.
      if (isDefinitiveRefreshRejection(error)) {
        // Delete while the advisory lock is still held. A waiter will then
        // observe no session instead of submitting the same rejected refresh
        // token and firing a second invalidation path.
        await deleteSession(sid, executor);
        return { kind: "invalid" };
      }
      return { kind: "transient", session: latest };
    }
  });
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  req.isAuthenticated = function (this: Request) {
    return this.user != null;
  } as Request["isAuthenticated"];

  const bearerToken = getBearerToken(req);

  // Supabase JWT path — 3-part base64url token (vs. legacy hex session IDs)
  if (bearerToken != null && bearerToken.split(".").length === 3 && supabaseAdmin) {
    try {
      const { data: { user } } = await supabaseAdmin.auth.getUser(bearerToken);
      if (user) {
        // BUG-01: reject tokens that have been explicitly server-side revoked
        // (e.g. the user already called POST /auth/logout with this token).
        // Supabase's own TTL can leave a valid JWT reusable for up to ~1 hour
        // after logout; the revocation table closes that window.
        const revoked = await isTokenRevoked(bearerToken);
        if (!revoked) {
          req.user = {
            // Account linking: if this Supabase identity was linked to an existing
            // account created via another provider (same email), app_metadata
            // carries the canonical user id — resolve to it so both sign-in
            // methods land on the same data.
            id: (user.app_metadata?.linkedUserId as string | undefined) ?? user.id,
            email: user.email ?? null,
            firstName:
              (user.user_metadata?.firstName ?? user.user_metadata?.first_name ?? null) as string | null,
            lastName:
              (user.user_metadata?.lastName ?? user.user_metadata?.last_name ?? null) as string | null,
            profileImageUrl: (user.user_metadata?.avatar_url ?? null) as string | null,
          };
        }
      }
    } catch {
      // Auth lookup failed transiently — treat as unauthenticated rather than
      // crashing the request. The route's requireAuth guard will reject if needed.
    }
    next();
    return;
  }

  const sid = getSessionId(req);

  if (!sid) {
    next();
    return;
  }

  try {
    const session = await getSession(sid);
    if (!session?.user?.id) {
      if (bearerToken) {
        // Bearer token not found as a session ID — try it as an OIDC access token
        const user = await getUserFromAccessToken(bearerToken);
        if (user) {
          req.user = user;
          next();
          return;
        }
      } else {
        await clearSession(res, sid);
      }
      next();
      return;
    }

    const refreshed = await refreshIfExpired(sid, session);
    if (refreshed.kind === "invalid") {
      // Session's stored expires_at has passed and it couldn't be refreshed —
      // enforce expiry for ALL session types: delete the session and force
      // re-auth (no fallback to a possibly-still-valid stored access token,
      // which would keep an expired session alive indefinitely).
      // refreshIfExpired deleted the invalid server session while holding its
      // per-SID lock; only cookie cleanup remains here.
      await clearSession(res);
      next();
      return;
    }

    req.user = refreshed.session.user;
    next();
  } catch {
    // Session lookup failed transiently — treat as unauthenticated rather than
    // crashing the request. The route's requireAuth guard will reject if needed.
    next();
  }
}
