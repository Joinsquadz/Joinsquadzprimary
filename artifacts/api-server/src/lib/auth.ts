import * as client from "openid-client";
import crypto from "crypto";
import { type Request, type Response } from "express";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { AuthUser } from "@workspace/api-zod";

export const ISSUER_URL = process.env.ISSUER_URL ?? "https://replit.com/oidc";
export const SESSION_COOKIE = "sid";
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

export interface SessionData {
  user: AuthUser;
  // Optional: OIDC sessions carry an access token; local email/password
  // sessions do not. authMiddleware only touches these for OIDC refresh, which
  // is gated on `expires_at` (absent for local sessions).
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

// ── Local email/password credential hashing ────────────────────────────────
// Uses Node's built-in scrypt (no native deps / esbuild issues). The stored
// string is self-describing: `scrypt$<N>$<saltHex>$<hashHex>`.
const SCRYPT_COST = 16384; // N
const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_COST,
  });
  return `scrypt$${SCRYPT_COST}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, costStr, saltHex, hashHex] = stored.split("$");
    if (scheme !== "scrypt" || !costStr || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = crypto.scryptSync(password, salt, expected.length, {
      N: Number(costStr),
    });
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

let oidcConfig: client.Configuration | null = null;

export async function getOidcConfig(): Promise<client.Configuration> {
  if (!oidcConfig) {
    oidcConfig = await client.discovery(
      new URL(ISSUER_URL),
      process.env.REPL_ID!,
    );
  }
  return oidcConfig;
}

export async function createSession(data: SessionData): Promise<string> {
  const sid = crypto.randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
  });
  return sid;
}

export async function getSession(sid: string): Promise<SessionData | null> {
  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, sid));

  if (!row || row.expire < new Date()) {
    if (row) await deleteSession(sid);
    return null;
  }

  return row.sess as unknown as SessionData;
}

export async function updateSession(
  sid: string,
  data: SessionData,
): Promise<void> {
  await db
    .update(sessionsTable)
    .set({
      sess: data as unknown as Record<string, unknown>,
      expire: new Date(Date.now() + SESSION_TTL),
    })
    .where(eq(sessionsTable.sid, sid));
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export async function clearSession(
  res: Response,
  sid?: string,
): Promise<void> {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function getSessionId(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return req.cookies?.[SESSION_COOKIE];
}

export function getBearerToken(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return undefined;
}

export async function getUserFromAccessToken(
  token: string,
): Promise<AuthUser | null> {
  try {
    const config = await getOidcConfig();
    const userInfo = await client.fetchUserInfo(
      config,
      token,
      client.skipSubjectCheck,
    );
    if (!userInfo.sub) return null;

    const userData = {
      id: userInfo.sub,
      email: (userInfo.email as string) ?? null,
      firstName:
        ((userInfo as Record<string, unknown>).first_name as string) ??
        (userInfo.given_name as string) ??
        null,
      lastName:
        ((userInfo as Record<string, unknown>).last_name as string) ??
        (userInfo.family_name as string) ??
        null,
      profileImageUrl:
        ((userInfo as Record<string, unknown>).profile_image_url as string) ??
        (userInfo.picture as string) ??
        null,
    };

    const [user] = await db
      .insert(usersTable)
      .values(userData)
      .onConflictDoUpdate({
        target: usersTable.id,
        set: { ...userData, updatedAt: new Date() },
      })
      .returning();

    return user
      ? {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          profileImageUrl: user.profileImageUrl,
        }
      : null;
  } catch {
    return null;
  }
}
