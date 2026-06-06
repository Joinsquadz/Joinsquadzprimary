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
    if (bearerToken) {
      // Session expired and couldn't refresh — try the stored access token via OIDC userinfo
      const user = await getUserFromAccessToken(session.access_token);
      if (user) {
        req.user = user;
        next();
        return;
      }
    }
    await clearSession(res, sid);
    next();
    return;
  }

  req.user = refreshed.user;
  next();
}
