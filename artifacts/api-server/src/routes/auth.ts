import * as oidc from "openid-client";
import crypto from "crypto";
import { z } from "zod/v4";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetCurrentAuthUserResponse,
  ExchangeMobileAuthorizationCodeBody,
  ExchangeMobileAuthorizationCodeResponse,
  LogoutMobileSessionResponse,
} from "@workspace/api-zod";
import { db, usersTable, authTokensTable, sessionsTable } from "@workspace/db";
import { and, eq, isNull, sql, gt } from "drizzle-orm";
import { isKeyRateLimited } from "../lib/rateLimiter";
import {
  clearSession,
  getOidcConfig,
  getSessionId,
  getBearerToken,
  getSession,
  createSession,
  deleteSession,
  revokeSupabaseToken,
  hashPassword,
  verifyPassword,
  SESSION_COOKIE,
  SESSION_TTL,
  ISSUER_URL,
  type SessionData,
} from "../lib/auth";
import { sendVerificationEmail, sendPasswordResetEmail } from "../emailService";
import { supabaseAdmin, supabaseAuth } from "../services/supabase";
import { isAnyTombstoned, AccountDeletedError } from "../lib/accountTombstones";
import { deriveAgeFields, MIN_SIGNUP_AGE } from "../lib/age";
import { trackEvent, identifyUser } from "../services/analytics";
import { logger } from "../lib/logger";
import { storage } from "../storage";
import { classifySupabaseRefreshError } from "../lib/authRefresh";

// C8: on logout, delete the device's push token server-side so a logged-out
// device stops receiving pushes. Best-effort — never blocks the logout.
async function clearPushTokenForSession(sid: string): Promise<void> {
  try {
    const session = await getSession(sid);
    const userId = session?.user?.id;
    if (userId) await storage.clearPushTokenForUser(userId);
  } catch (err) {
    logger.error({ err }, "Failed to clear push token on logout");
  }
}

const OIDC_COOKIE_TTL = 10 * 60 * 1000;

const router: IRouter = Router();

function getOrigin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host =
    req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  return `${proto}://${host}`;
}

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function setOidcCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: OIDC_COOKIE_TTL,
  });
}

function getSafeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

// Hosts we will redirect the mobile web flow back to. Limited to this repl's
// own dev domains and any deployed domains so the bouncer can't be used as an
// open redirect.
function getAllowedReturnHosts(): Set<string> {
  const hosts = new Set<string>();
  const add = (raw?: string) => {
    if (!raw) return;
    const h = raw.trim().replace(/^https?:\/\//, "").split("/")[0];
    if (h) hosts.add(h.toLowerCase());
  };
  add(process.env.REPLIT_DEV_DOMAIN);
  add(process.env.REPLIT_EXPO_DEV_DOMAIN);
  (process.env.REPLIT_DOMAINS ?? "").split(",").forEach(add);
  return hosts;
}

// Validate the app URL the mobile flow should return to. We accept two shapes,
// because the same bouncer serves both the Expo *web* app and the *native*
// (iOS/Android) app:
//   1. https on one of this repl's allowed hosts — the Expo web build.
//   2. a native deep-link scheme — the app's own `squadz-native://` scheme
//      (standalone / dev-client builds), plus Expo Go's `exp://` scheme, which
//      is only honored outside production since its dev host (LAN/tunnel) varies
//      and can't be pinned. This lets the native auth session capture the token.
// Any fragment is stripped because we append the session token (or error) as a
// fragment ourselves.
const NATIVE_SCHEME = "squadz-native:";

function sanitizeMobileReturnTo(value: unknown, req: Request): string {
  const fallback = `${getOrigin(req)}/mobile/login`;
  if (typeof value !== "string" || !value) return fallback;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return fallback;
  }
  const isHttpsAllowed =
    u.protocol === "https:" &&
    getAllowedReturnHosts().has(u.hostname.toLowerCase());
  const isNativeScheme =
    u.protocol === NATIVE_SCHEME ||
    (u.protocol === "exp:" && process.env.NODE_ENV !== "production");
  if (!isHttpsAllowed && !isNativeScheme) return fallback;
  u.hash = "";
  return u.toString();
}

// Thrown when a sign-in would auto-merge into an existing account via an
// UNVERIFIED email claim — that would let anyone claiming your email take over
// your account. Callers surface a clear "sign in with your original method".
export class EmailLinkingError extends Error {
  constructor() {
    super("An account with this email already exists. Sign in with your original method.");
    this.name = "EmailLinkingError";
  }
}

async function upsertUser(claims: Record<string, unknown>) {
  const profileData = {
    id: claims.sub as string,
    email: normalizeEmail((claims.email as string) || "") || null,
    firstName: (claims.first_name as string) || null,
    lastName: (claims.last_name as string) || null,
    profileImageUrl: (claims.profile_image_url || claims.picture) as
      | string
      | null,
  };

  // Account linking: if this email already belongs to a user created via a
  // different auth provider (e.g. email/password → Supabase UUID), attach this
  // sign-in method to that SAME account instead of erroring on the unique
  // email constraint. Same person, same data — just a second way to sign in.
  if (profileData.email) {
    const [byEmail] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, profileData.email));
    if (byEmail && byEmail.id !== profileData.id) {
      // Only trust the merge when the provider asserts a VERIFIED email —
      // unverified claims must not link into (and take over) an existing
      // account that merely shares the address.
      if (claims.email_verified !== true) {
        throw new EmailLinkingError();
      }
      const [linked] = await db
        .update(usersTable)
        .set({
          firstName: byEmail.firstName ?? profileData.firstName,
          lastName: byEmail.lastName ?? profileData.lastName,
          profileImageUrl: byEmail.profileImageUrl ?? profileData.profileImageUrl,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, byEmail.id))
        .returning();
      return linked ?? byEmail;
    }
  }

  const [user] = await db
    .insert(usersTable)
    .values({ ...profileData, friendCode: generateFriendCode() })
    .onConflictDoUpdate({
      target: usersTable.id,
      set: {
        ...profileData,
        updatedAt: new Date(),
      },
    })
    .returning();
  return user;
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json(
    GetCurrentAuthUserResponse.parse({
      user: req.isAuthenticated() ? req.user : null,
    }),
  );
});

router.get("/login", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const returnTo = getSafeReturnTo(req.query.returnTo);

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: "openid email profile offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "login consent",
    state,
    nonce,
  });

  setOidcCookie(res, "code_verifier", codeVerifier);
  setOidcCookie(res, "nonce", nonce);
  setOidcCookie(res, "state", state);
  setOidcCookie(res, "return_to", returnTo);

  res.redirect(redirectTo.href);
});

// Query params are not validated because the OIDC provider may include
// parameters not expressed in the schema.
router.get("/callback", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/callback`;

  const codeVerifier = req.cookies?.code_verifier;
  const nonce = req.cookies?.nonce;
  const expectedState = req.cookies?.state;

  if (!codeVerifier || !expectedState) {
    res.redirect("/api/login");
    return;
  }

  const currentUrl = new URL(
    `${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`,
  );

  let tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers;
  try {
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
  } catch {
    res.redirect("/api/login");
    return;
  }

  const returnTo = getSafeReturnTo(req.cookies?.return_to);

  res.clearCookie("code_verifier", { path: "/" });
  res.clearCookie("nonce", { path: "/" });
  res.clearCookie("state", { path: "/" });
  res.clearCookie("return_to", { path: "/" });

  const claims = tokens.claims();
  if (!claims) {
    res.redirect("/api/login");
    return;
  }

  let dbUser;
  try {
    dbUser = await upsertUser(claims as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof EmailLinkingError) {
      res.redirect(`${returnTo}#error=${encodeURIComponent(err.message)}`);
      return;
    }
    throw err;
  }

  const now = Math.floor(Date.now() / 1000);
  const sessionData: SessionData = {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      profileImageUrl: dbUser.profileImageUrl,
    },
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.redirect(returnTo);
});

// ── Mobile web sign-in bouncer ─────────────────────────────────────────────
// The Expo web app runs on a subdomain (…expo.kirk.replit.dev) that is NOT in
// REPLIT_DOMAINS, so the Replit OIDC provider rejects a redirect_uri pointing
// at it. These two routes run the whole OIDC flow on the main domain (always an
// allowed redirect target), then hand the minted session token back to the app
// via the URL fragment. The app only has to open this URL (in a top-level tab,
// since the Replit login page can't be framed) and read `#token=…` on return.
router.get("/mobile-auth/web-login", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/mobile-auth/web-callback`;
  const returnTo = sanitizeMobileReturnTo(req.query.returnTo, req);

  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);

  const redirectTo = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: "openid email profile offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "login consent",
    state,
    nonce,
  });

  setOidcCookie(res, "m_code_verifier", codeVerifier);
  setOidcCookie(res, "m_nonce", nonce);
  setOidcCookie(res, "m_state", state);
  setOidcCookie(res, "m_return_to", returnTo);

  res.redirect(redirectTo.href);
});

// Query params are not validated because the OIDC provider may include
// parameters not expressed in the schema.
router.get("/mobile-auth/web-callback", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const callbackUrl = `${getOrigin(req)}/api/mobile-auth/web-callback`;

  const codeVerifier = req.cookies?.m_code_verifier;
  const nonce = req.cookies?.m_nonce;
  const expectedState = req.cookies?.m_state;
  const returnTo = sanitizeMobileReturnTo(req.cookies?.m_return_to, req);

  res.clearCookie("m_code_verifier", { path: "/" });
  res.clearCookie("m_nonce", { path: "/" });
  res.clearCookie("m_state", { path: "/" });
  res.clearCookie("m_return_to", { path: "/" });

  if (!codeVerifier || !expectedState) {
    res.redirect(`${returnTo}#error=auth`);
    return;
  }

  try {
    const currentUrl = new URL(
      `${callbackUrl}?${new URL(req.url, `http://${req.headers.host}`).searchParams}`,
    );
    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });

    const claims = tokens.claims();
    if (!claims) {
      res.redirect(`${returnTo}#error=auth`);
      return;
    }

    let dbUser;
    try {
      dbUser = await upsertUser(claims as unknown as Record<string, unknown>);
    } catch (err) {
      if (err instanceof EmailLinkingError) {
        res.redirect(`${returnTo}#error=${encodeURIComponent(err.message)}`);
        return;
      }
      throw err;
    }

    const now = Math.floor(Date.now() / 1000);
    const sessionData: SessionData = {
      user: {
        id: dbUser.id,
        email: dbUser.email,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        profileImageUrl: dbUser.profileImageUrl,
      },
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
    };

    const sid = await createSession(sessionData);
    res.redirect(`${returnTo}#token=${encodeURIComponent(sid)}`);
  } catch (err) {
    req.log.error({ err }, "Mobile web auth callback error");
    res.redirect(`${returnTo}#error=auth`);
  }
});

router.get("/logout", async (req: Request, res: Response) => {
  const config = await getOidcConfig();
  const origin = getOrigin(req);

  const sid = getSessionId(req);
  if (sid) await clearPushTokenForSession(sid);
  await clearSession(res, sid);

  const endSessionUrl = oidc.buildEndSessionUrl(config, {
    client_id: process.env.REPL_ID!,
    post_logout_redirect_uri: origin,
  });

  res.redirect(endSessionUrl.href);
});

router.post(
  "/mobile-auth/token-exchange",
  async (req: Request, res: Response) => {
    const parsed = ExchangeMobileAuthorizationCodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required parameters" });
      return;
    }

    const { code, code_verifier, redirect_uri, state, nonce } = parsed.data;

    try {
      const config = await getOidcConfig();

      const callbackUrl = new URL(redirect_uri);
      callbackUrl.searchParams.set("code", code);
      callbackUrl.searchParams.set("state", state);
      callbackUrl.searchParams.set("iss", ISSUER_URL);

      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        pkceCodeVerifier: code_verifier,
        expectedNonce: nonce ?? undefined,
        expectedState: state,
        idTokenExpected: true,
      });

      const claims = tokens.claims();
      if (!claims) {
        res.status(401).json({ error: "No claims in ID token" });
        return;
      }

      let dbUser;
      try {
        dbUser = await upsertUser(claims as unknown as Record<string, unknown>);
      } catch (upsertErr) {
        if (upsertErr instanceof EmailLinkingError) {
          res.status(409).json({ error: upsertErr.message });
          return;
        }
        throw upsertErr;
      }

      const now = Math.floor(Date.now() / 1000);
      const sessionData: SessionData = {
        user: {
          id: dbUser.id,
          email: dbUser.email,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          profileImageUrl: dbUser.profileImageUrl,
        },
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expiresIn() ? now + tokens.expiresIn()! : claims.exp,
      };

      const sid = await createSession(sessionData);
      res.json(ExchangeMobileAuthorizationCodeResponse.parse({ token: sid }));
    } catch (err) {
      req.log.error({ err }, "Mobile token exchange error");
      res.status(500).json({ error: "Token exchange failed" });
    }
  },
);

router.post("/mobile-auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) {
    await clearPushTokenForSession(sid);
    await deleteSession(sid);
  }
  res.json(LogoutMobileSessionResponse.parse({ success: true }));
});

// ── Local email/password auth ───────────────────────────────────────────────
// Plain-JSON routes (inline Zod, no OpenAPI codegen) per repo convention. The
// mobile app sends `Authorization: Bearer <sid>`; sessions created here carry no
// OIDC tokens, so authMiddleware treats them as non-expiring local sessions.

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  phone: z.string().trim().max(40).optional(),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  // Age gate: required for every new account. The value is used to derive
  // `meetsMinAge` + `birthYear`; no exact date is collected or persisted.
  birthYear: z.string().trim().min(1).max(4),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

const forgotSchema = z.object({ email: z.string().email().max(254) });

const resetSchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(8).max(200),
});

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function issueAuthToken(
  userId: string,
  type: "email_verify" | "password_reset",
  ttlMs: number,
): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex");
  await db.insert(authTokensTable).values({
    userId,
    type,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return raw;
}

function generateFriendCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "SQ-";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function toAuthUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    profileImageUrl: u.profileImageUrl,
    friendCode: u.friendCode,
  };
}

/**
 * Ensure a Supabase Auth user exists in our Postgres users table.
 * Uses the Supabase UUID as the primary key so that JWTs resolve directly.
 * On conflict (same id) updates email + name metadata; on email conflict
 * that would violate the unique constraint, the upsert is skipped.
 */
async function syncSupabaseUser(
  supabaseUser: {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
  },
  extras: {
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    // Age-gate fields, only ever supplied by the registration path. Login-time
    // syncs omit them so an existing user's stored marker is never overwritten.
    meetsMinAge?: boolean;
    birthYear?: number;
  } = {},
): Promise<typeof usersTable.$inferSelect> {
  // Deleted-account backstop: if this auth subject (or the canonical account
  // it was linked to) was tombstoned by account deletion, never re-provision
  // a users row for it. Delete the straggler Supabase subject when possible
  // so the credentials die for good.
  const linkedUserId = supabaseUser.app_metadata?.linkedUserId as string | undefined;
  if (await isAnyTombstoned([supabaseUser.id, ...(linkedUserId ? [linkedUserId] : [])])) {
    if (supabaseAdmin) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(supabaseUser.id);
      } catch (err) {
        logger.error({ err, subjectId: supabaseUser.id }, "Failed to delete tombstoned Supabase auth subject at login");
      }
    }
    throw new AccountDeletedError();
  }

  const email = normalizeEmail(supabaseUser.email ?? "");
  const firstName = (
    extras.firstName ??
    (supabaseUser.user_metadata?.firstName as string | undefined) ??
    (supabaseUser.user_metadata?.first_name as string | undefined) ??
    null
  );
  const lastName = (
    extras.lastName ??
    (supabaseUser.user_metadata?.lastName as string | undefined) ??
    (supabaseUser.user_metadata?.last_name as string | undefined) ??
    null
  );

  // Account linking: if this email already belongs to a row with a DIFFERENT
  // id (e.g. the user originally signed up via Replit OAuth, whose OIDC `sub`
  // is the row id), link the Supabase identity to that existing account
  // instead of violating the unique email constraint with a hard 500. We
  // record the mapping once in the Supabase user's app_metadata so the auth
  // middleware can resolve every future JWT to the linked account without an
  // extra DB query per request.
  const [byEmail] = email
    ? await db.select().from(usersTable).where(eq(usersTable.email, email))
    : [];
  if (byEmail && byEmail.id !== supabaseUser.id) {
    if (supabaseAdmin) {
      try {
        await supabaseAdmin.auth.admin.updateUserById(supabaseUser.id, {
          app_metadata: { linkedUserId: byEmail.id },
        });
      } catch (err) {
        logger.error({ err }, "Failed to store linkedUserId in Supabase app_metadata");
      }
    }
    const [linked] = await db
      .update(usersTable)
      .set({
        firstName: byEmail.firstName ?? firstName ?? null,
        lastName: byEmail.lastName ?? lastName ?? null,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, byEmail.id))
      .returning();
    return linked ?? byEmail;
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      id: supabaseUser.id,
      email,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      phone: extras.phone ?? null,
      emailVerified: false,
      friendCode: generateFriendCode(),
      ...(extras.meetsMinAge !== undefined ? { meetsMinAge: extras.meetsMinAge } : {}),
      ...(extras.birthYear !== undefined ? { birthYear: extras.birthYear } : {}),
    })
    .onConflictDoUpdate({
      target: usersTable.id,
      set: {
        email,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return user;
}

// ── Persistent DB-backed rate limiter (per IP + bucket) ──────────────────────
// BUG-04 (logic now shared via lib/rateLimiter.ts): thin wrapper that keys by
// IP + bucket and delegates to the shared atomic upsert. The API-wide
// middleware in app.ts also uses the same shared logic for horizontal-scaling
// consistency (state survives restarts, consistent across instances).
async function rateLimited(req: Request, bucket: string, max: number): Promise<boolean> {
  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
  const { limited } = await isKeyRateLimited(`${bucket}:${ip}`, max);
  return limited;
}

async function sendVerification(req: Request, user: typeof usersTable.$inferSelect) {
  if (!user.email) return;
  const raw = await issueAuthToken(user.id, "email_verify", EMAIL_VERIFY_TTL_MS);
  const verifyUrl = `${getOrigin(req)}/api/auth/verify-email?token=${raw}`;
  try {
    await sendVerificationEmail({ toEmail: user.email, verifyUrl });
  } catch (err) {
    req.log.error({ err }, "Failed to send verification email");
  }
}

router.post("/auth/register", async (req: Request, res: Response) => {
  if (await rateLimited(req, "register", 10)) {
    res.status(429).json({ error: "Too many attempts. Please try again later." });
    return;
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    const birthYearIssue = parsed.error.issues.find((i) => i.path[0] === "birthYear");
    const missingBirthYear =
      birthYearIssue !== undefined &&
      (!req.body || !Object.prototype.hasOwnProperty.call(req.body, "birthYear"));
    res.status(400).json({
      error: birthYearIssue
        ? missingBirthYear ? "Birth year is required." : "Enter a valid birth year."
        : "Invalid email or password (min 8 characters).",
      ...(birthYearIssue ? { code: missingBirthYear ? "BIRTH_YEAR_REQUIRED" : "BIRTH_YEAR_INVALID" } : {}),
    });
    return;
  }
  const email = normalizeEmail(parsed.data.email);
  const { password, phone, firstName, lastName, birthYear } = parsed.data;

  // ── Age gate (13+) — server-side enforcement ────────────────────────────────
  // The mobile birth-year field is UX only; this check is the actual gate, so a
  // direct API call cannot create an under-13 account. Runs before ANY account
  // is provisioned (Supabase subject included) so nothing is left behind.
  const ageCheck = deriveAgeFields(birthYear);
  if (!ageCheck.ok) {
    if (ageCheck.reason === "under_age") {
      res.status(403).json({
        error: `You must be at least ${MIN_SIGNUP_AGE} to use SquadZ.`,
        code: "UNDER_MIN_AGE",
      });
      return;
    }
    res.status(400).json({ error: "Enter a valid birth year.", code: "BIRTH_YEAR_INVALID" });
    return;
  }
  const ageFields = ageCheck.fields;

  // --- Supabase Auth path (when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set) ---
  if (supabaseAdmin && supabaseAuth) {
    // Mark the Supabase user as confirmed at creation so a session is issued
    // immediately (and future logins work). Email verification is handled by
    // our OWN flow (sendVerification → /auth/verify-email sets
    // users.emailVerified), which is the real source of truth — Supabase's
    // email_confirmed_at is only used here to unblock password sign-in.
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { firstName: firstName || null, lastName: lastName || null, phone: phone || null },
    });
    if (createErr) {
      const isConflict =
        createErr.message?.toLowerCase().includes("already") ||
        (createErr as unknown as { status?: number }).status === 422;
      res.status(isConflict ? 409 : 400).json({
        error: isConflict ? "An account with this email already exists." : createErr.message,
      });
      return;
    }
    const { data: signIn } = await supabaseAuth.auth.signInWithPassword({ email, password });
    let dbUser: Awaited<ReturnType<typeof syncSupabaseUser>>;
    try {
      dbUser = await syncSupabaseUser(created.user, {
        firstName,
        lastName,
        phone,
        meetsMinAge: ageFields.meetsMinAge,
        birthYear: ageFields.birthYear,
      });
    } catch (err) {
      if (err instanceof AccountDeletedError) {
        // Defensive: a brand-new signup gets a fresh subject id, so this only
        // fires if a tombstoned subject somehow reached the sync path.
        res.status(409).json({ error: "An account with this email already exists." });
        return;
      }
      throw err;
    }
    identifyUser(dbUser.id, { email, firstName: dbUser.firstName ?? undefined, lastName: dbUser.lastName ?? undefined });
    trackEvent(dbUser.id, "signup", { method: "email" });
    res.json({
      token: signIn.session?.access_token ?? "",
      refreshToken: signIn.session?.refresh_token ?? "",
      user: toAuthUser(dbUser),
      emailVerified: false,
      phone: dbUser.phone,
    });
    return;
  }
  // ---------------------------------------------------------------------------------

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "An account with this email already exists." });
    return;
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: hashPassword(password),
      phone: phone || null,
      firstName: firstName || null,
      lastName: lastName || null,
      emailVerified: false,
      friendCode: generateFriendCode(),
      meetsMinAge: ageFields.meetsMinAge,
      birthYear: ageFields.birthYear,
    })
    .returning();

  const token = await createSession({ user: toAuthUser(user) });
  res.json({
    token,
    user: toAuthUser(user),
    emailVerified: false,
    phone: user.phone,
  });
});

router.post("/auth/login", async (req: Request, res: Response) => {
  if (await rateLimited(req, "login", 20)) {
    res.status(429).json({ error: "Too many attempts. Please try again later." });
    return;
  }
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }
  const email = normalizeEmail(parsed.data.email);

  // --- Supabase Auth path (when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set) ---
  if (supabaseAdmin && supabaseAuth) {
    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email,
      password: parsed.data.password,
    });
    if (error || !data.session) {
      // The mobile client deliberately keeps credential errors generic. Record
      // only the provider's safe category/status so production incidents can be
      // diagnosed without logging an email address, password, token, or body.
      logger.warn(
        {
          authProviderStatus: error?.status ?? null,
          authProviderCode: error?.code ?? null,
          reason: error ? "provider_rejected" : "session_missing",
        },
        "Email/password sign-in did not return a session",
      );
      res.status(401).json({ error: "Incorrect email or password." });
      return;
    }
    let dbUser: Awaited<ReturnType<typeof syncSupabaseUser>>;
    try {
      dbUser = await syncSupabaseUser(data.user);
    } catch (err) {
      if (err instanceof AccountDeletedError) {
        // Deleted account whose auth subject survived — present as a normal
        // credential failure; the subject was re-deleted above best-effort.
        res.status(401).json({ error: "Incorrect email or password." });
        return;
      }
      throw err;
    }
    identifyUser(dbUser.id, { email, firstName: dbUser.firstName ?? undefined, lastName: dbUser.lastName ?? undefined });
    trackEvent(dbUser.id, "login", { method: "email" });
    res.json({
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
      user: toAuthUser(dbUser),
      // Reflect OUR verification flow (users.emailVerified), not Supabase's
      // email_confirmed_at — we confirm Supabase users at creation to unblock
      // sign-in, so its flag is always true and not a real verification signal.
      emailVerified: dbUser.emailVerified,
      phone: dbUser.phone,
    });
    return;
  }
  // ---------------------------------------------------------------------------------

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));

  if (!user || !user.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash)) {
    res.status(401).json({ error: "Incorrect email or password." });
    return;
  }

  const token = await createSession({ user: toAuthUser(user) });
  res.json({
    token,
    user: toAuthUser(user),
    emailVerified: user.emailVerified,
    phone: user.phone,
  });
});

router.post("/auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  const bearer = getBearerToken(req);

  if (sid) {
    await clearPushTokenForSession(sid);
    await deleteSession(sid);
  }

  // BUG-01: if the caller used a Supabase JWT bearer token, revoke it so the
  // remaining TTL (up to ~1 hour) can't be exploited to re-authenticate.
  if (bearer && bearer.split(".").length === 3) {
    try {
      await revokeSupabaseToken(bearer);
    } catch (err) {
      logger.warn({ err }, "Failed to revoke Supabase token on logout");
    }
  }

  res.json({ ok: true });
});

/**
 * POST /api/auth/refresh
 * Exchange a Supabase refresh token for a new access token + refresh token pair.
 * No-ops (501) when Supabase is not configured.
 */
router.post("/auth/refresh", async (req: Request, res: Response) => {
  if (!supabaseAuth) {
    res.status(501).json({ error: "Token refresh requires Supabase to be configured." });
    return;
  }
  const { refreshToken } = (req.body ?? {}) as { refreshToken?: string };
  if (!refreshToken) {
    res.status(400).json({ error: "refreshToken is required." });
    return;
  }
  try {
    const { data, error } = await supabaseAuth.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error) {
      if (classifySupabaseRefreshError(error) === "invalid") {
        res.status(401).json({ error: "Invalid or expired refresh token." });
      } else {
        req.log.warn(
          {
            authProviderStatus: error.status ?? null,
            authProviderCode: error.code ?? null,
          },
          "Supabase session refresh failed transiently",
        );
        res.status(503).json({ error: "Session refresh temporarily unavailable." });
      }
      return;
    }
    if (!data.session) {
      // A success-shaped response without a session is not proof that the
      // refresh credential is invalid. Preserve the client session and retry.
      res.status(503).json({ error: "Session refresh temporarily unavailable." });
      return;
    }
    res.json({
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
    });
  } catch (error) {
    req.log.warn({ err: error }, "Supabase session refresh request failed");
    res.status(503).json({ error: "Session refresh temporarily unavailable." });
  }
});

router.get("/auth/me", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  let [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!user.friendCode) {
    const code = generateFriendCode();
    const [updated] = await db
      .update(usersTable)
      .set({ friendCode: code })
      .where(eq(usersTable.id, user.id))
      .returning();
    if (updated) user = updated;
  }
  res.json({
    user: toAuthUser(user),
    emailVerified: user.emailVerified,
    phone: user.phone,
  });
});

router.post("/auth/resend-verification", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (await rateLimited(req, "resend", 5)) {
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));
  if (user && !user.emailVerified) {
    await sendVerification(req, user);
  }
  res.json({ ok: true });
});

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${title}</title>
<style>
  body{margin:0;background:#0f0f1a;color:#e8e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px;}
  .card{background:#1a1a2e;border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:40px;max-width:420px;width:100%;text-align:center;}
  h1{font-size:22px;margin:0 0 12px;color:#fff;}
  p{color:#9898b0;font-size:15px;line-height:1.5;margin:0 0 20px;}
  .brand{font-size:24px;font-weight:800;margin-bottom:24px;color:#fff;}
  input{width:100%;box-sizing:border-box;background:#13132a;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:14px;color:#fff;font-size:15px;margin-bottom:12px;}
  button{width:100%;border:0;border-radius:10px;padding:14px;font-size:15px;font-weight:700;color:#fff;background:linear-gradient(135deg,#FF5C3A,#A855F7);cursor:pointer;}
  .err{color:#f87171;}.ok{color:#2ECC8A;}
</style></head><body><div class="card"><div class="brand">SquadZ</div>${body}</div></body></html>`;
}

router.get("/auth/verify-email", async (req: Request, res: Response) => {
  const raw = typeof req.query.token === "string" ? req.query.token : "";
  if (!raw) {
    res.status(400).send(htmlPage("Invalid link", `<h1 class="err">Invalid link</h1><p>This verification link is missing its token.</p>`));
    return;
  }
  const [tok] = await db
    .select()
    .from(authTokensTable)
    .where(
      and(
        eq(authTokensTable.tokenHash, hashToken(raw)),
        eq(authTokensTable.type, "email_verify"),
        isNull(authTokensTable.usedAt),
        gt(authTokensTable.expiresAt, new Date()),
      ),
    );
  if (!tok) {
    res.status(400).send(htmlPage("Link expired", `<h1 class="err">Link expired</h1><p>This verification link is invalid or has expired. Open the app and request a new one.</p>`));
    return;
  }
  await db
    .update(usersTable)
    .set({ emailVerified: true })
    .where(eq(usersTable.id, tok.userId));
  await db
    .update(authTokensTable)
    .set({ usedAt: new Date() })
    .where(eq(authTokensTable.id, tok.id));

  res.send(htmlPage("Email confirmed", `<h1 class="ok">Email confirmed ✓</h1><p>Your email is verified. You can close this tab and return to the SquadZ app.</p>`));
});

router.post("/auth/forgot-password", async (req: Request, res: Response) => {
  if (await rateLimited(req, "forgot", 5)) {
    res.status(429).json({ error: "Too many requests. Please try again later." });
    return;
  }
  const parsed = forgotSchema.safeParse(req.body);
  // Always respond ok to avoid leaking which emails are registered.
  if (parsed.success) {
    const email = normalizeEmail(parsed.data.email);
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));
    if (user && user.email) {
      if (supabaseAdmin && !user.passwordHash) {
        // Supabase Auth user — generate a recovery link and send it via our email service.
        try {
          // Generate a recovery token and email a link to OUR reset page using the
          // hashed_token (verified server-side). We deliberately do NOT use
          // Supabase's action_link / redirectTo: Supabase only redirects to URLs in
          // its project Redirect-URL allowlist and otherwise silently falls back to
          // the Site URL (e.g. http://localhost:3000), which breaks the reset.
          const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
            type: "recovery",
            email,
          });
          if (linkErr) throw linkErr;
          const tokenHash = linkData?.properties?.hashed_token;
          if (tokenHash) {
            const resetUrl = `${getOrigin(req)}/api/auth/reset-supabase?token_hash=${encodeURIComponent(tokenHash)}`;
            await sendPasswordResetEmail({ toEmail: user.email, resetUrl });
          }
        } catch (err) {
          req.log.error({ err }, "Failed to send Supabase password reset email");
        }
      } else if (user.passwordHash) {
        // Local auth user — existing token-based reset flow.
        const raw = await issueAuthToken(user.id, "password_reset", PASSWORD_RESET_TTL_MS);
        const resetUrl = `${getOrigin(req)}/api/auth/reset-password?token=${raw}`;
        try {
          await sendPasswordResetEmail({ toEmail: user.email, resetUrl });
        } catch (err) {
          req.log.error({ err }, "Failed to send password reset email");
        }
      }
    }
  }
  res.json({ ok: true });
});

// ── Supabase password reset landing page ─────────────────────────────────────
// The recovery email links here with ?token_hash=<hashed_token>. The token is
// verified server-side (POST below) — no Supabase redirect / URL fragment is
// involved, so it doesn't depend on the project's Redirect-URL allowlist.
router.get("/auth/reset-supabase", (req: Request, res: Response) => {
  const tokenHash = typeof req.query.token_hash === "string" ? req.query.token_hash : "";
  if (!tokenHash) {
    res
      .status(400)
      .send(
        htmlPage(
          "Invalid link",
          `<h1 class="err">Invalid link</h1><p>This reset link is missing its token. Tap <b>Forgot password?</b> in the app to request a new one.</p>`,
        ),
      );
    return;
  }
  res.send(
    htmlPage(
      "Reset your password",
      `<h1>Choose a new password</h1>
<p>Enter a new password for your SquadZ account.</p>
<form id="form">
  <input type="hidden" id="th" value="${tokenHash.replace(/"/g, "")}" />
  <input type="password" id="pw" placeholder="New password (8+ characters)" minlength="8" required autofocus />
  <button type="submit" id="btn">Reset password</button>
</form>
<p id="msg" style="display:none"></p>
<script>
(function(){
  var formEl=document.getElementById('form');
  var msgEl=document.getElementById('msg');
  formEl.addEventListener('submit',function(e){
    e.preventDefault();
    var btn=document.getElementById('btn');
    btn.disabled=true;btn.textContent='Resetting…';
    fetch('/api/auth/reset-supabase',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token_hash:document.getElementById('th').value,password:document.getElementById('pw').value})
    }).then(function(r){return r.json();}).then(function(d){
      if(d.ok){
        formEl.style.display='none';
        msgEl.style.display='block';
        msgEl.innerHTML='<h1 class="ok">Password updated ✓</h1><p>Your password has been changed. Open the SquadZ app and sign in with your new password.</p>';
      } else {
        msgEl.style.display='block';
        msgEl.innerHTML='<p class="err">'+(d.error||'Please try again.')+'</p>';
        btn.disabled=false;btn.textContent='Reset password';
      }
    }).catch(function(){
      msgEl.style.display='block';
      msgEl.innerHTML='<p class="err">Network error. Please check your connection and try again.</p>';
      btn.disabled=false;btn.textContent='Reset password';
    });
  });
})();
</script>`,
    ),
  );
});

router.post("/auth/reset-supabase", async (req: Request, res: Response) => {
  if (await rateLimited(req, "reset-supabase", 10)) {
    res.status(429).json({ error: "Too many attempts. Please try again later." });
    return;
  }
  if (!supabaseAdmin || !supabaseAuth) {
    res.status(400).json({ error: "This reset method is not available." });
    return;
  }
  const { token_hash, password } = req.body as { token_hash?: string; password?: string };
  if (!token_hash || typeof token_hash !== "string") {
    res.status(400).json({ error: "This reset link is invalid or has expired." });
    return;
  }
  if (!password || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }
  // Verify the recovery token_hash server-side. This proves ownership of the
  // email without relying on any browser redirect / fragment.
  const { data, error: verifyErr } = await supabaseAuth.auth.verifyOtp({
    token_hash,
    type: "recovery",
  });
  if (verifyErr || !data.user) {
    res.status(400).json({ error: "This reset link is invalid or has expired. Request a new one from the app." });
    return;
  }
  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, { password });
  if (updateErr) {
    req.log.error({ err: updateErr }, "Supabase password update failed");
    res.status(400).json({ error: updateErr.message ?? "Couldn't update password. Please try again." });
    return;
  }
  res.json({ ok: true });
});

router.get("/auth/reset-password", (req: Request, res: Response) => {
  const raw = typeof req.query.token === "string" ? req.query.token : "";
  if (!raw) {
    res.status(400).send(htmlPage("Invalid link", `<h1 class="err">Invalid link</h1><p>This reset link is missing its token.</p>`));
    return;
  }
  res.send(
    htmlPage(
      "Reset password",
      `<h1>Choose a new password</h1>
<p>Enter a new password for your SquadZ account.</p>
<form method="POST" action="/api/auth/reset-password">
  <input type="hidden" name="token" value="${raw.replace(/[&<>"']/g, (c: string) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] ?? c))}" />
  <input type="password" name="password" placeholder="New password (8+ characters)" minlength="8" required autofocus />
  <button type="submit">Reset Password</button>
</form>`,
    ),
  );
});

router.post("/auth/reset-password", async (req: Request, res: Response) => {
  if (await rateLimited(req, "reset", 10)) {
    res.status(429).json({ error: "Too many attempts. Please try again later." });
    return;
  }
  const parsed = resetSchema.safeParse(req.body);
  const wantsHtml = (req.headers["content-type"] ?? "").includes("form");
  if (!parsed.success) {
    if (wantsHtml) {
      res.status(400).send(htmlPage("Invalid", `<h1 class="err">Couldn't reset</h1><p>Password must be at least 8 characters. Please go back and try again.</p>`));
    } else {
      res.status(400).json({ error: "Password must be at least 8 characters." });
    }
    return;
  }

  const [tok] = await db
    .select()
    .from(authTokensTable)
    .where(
      and(
        eq(authTokensTable.tokenHash, hashToken(parsed.data.token)),
        eq(authTokensTable.type, "password_reset"),
        isNull(authTokensTable.usedAt),
        gt(authTokensTable.expiresAt, new Date()),
      ),
    );
  if (!tok) {
    if (wantsHtml) {
      res.status(400).send(htmlPage("Link expired", `<h1 class="err">Link expired</h1><p>This reset link is invalid or has expired. Request a new one from the app.</p>`));
    } else {
      res.status(400).json({ error: "This reset link is invalid or has expired." });
    }
    return;
  }

  await db
    .update(usersTable)
    .set({ passwordHash: hashPassword(parsed.data.password) })
    .where(eq(usersTable.id, tok.userId));
  await db
    .update(authTokensTable)
    .set({ usedAt: new Date() })
    .where(eq(authTokensTable.id, tok.id));
  // Invalidate all existing sessions for this user (force re-login everywhere).
  await db
    .delete(sessionsTable)
    .where(sql`${sessionsTable.sess}->'user'->>'id' = ${tok.userId}`);

  if (wantsHtml) {
    res.send(htmlPage("Password reset", `<h1 class="ok">Password updated ✓</h1><p>Your password has been changed. Open the SquadZ app and sign in with your new password.</p>`));
  } else {
    res.json({ ok: true });
  }
});

export default router;
