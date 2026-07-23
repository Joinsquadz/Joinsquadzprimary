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
  updateSession,
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

async function refreshIfExpired(
  sid: string,
  session: SessionData,
): Promise<SessionData | null> {
  const now = Math.floor(Date.now() / 1000);
  if (!session.expires_at || now <= session.expires_at) return session;

  if (!session.refresh_token) return null;

  try {
    const config = await getOidcConfig();
    const tokens = await oidc.refreshTokenGrant(
      config,
      session.refresh_token,
    );
    session.access_token = tokens.access_token;
    session.refresh_token = tokens.refresh_token ?? session.refresh_token;
    session.expires_at = tokens.expiresIn()
      ? now + tokens.expiresIn()!
      : session.expires_at;
    await updateSession(sid, session);
    return session;
  } catch {
    return null;
  }
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
    const { data: { user } } = await supabaseAdmin.auth.getUser(bearerToken);
    if (user) {
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
    next();
    return;
  }

  const sid = getSessionId(req);

  if (!sid) {
    next();
    return;
  }

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
  if (!refreshed) {
    // Session's stored expires_at has passed and it couldn't be refreshed —
    // enforce expiry for ALL session types: delete the session and force
    // re-auth (no fallback to a possibly-still-valid stored access token,
    // which would keep an expired session alive indefinitely).
    await clearSession(res, sid);
    next();
    return;
  }

  req.user = refreshed.user;
  next();
}
