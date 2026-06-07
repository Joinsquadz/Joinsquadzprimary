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
import {
  clearSession,
  getOidcConfig,
  getSessionId,
  createSession,
  deleteSession,
  hashPassword,
  verifyPassword,
  SESSION_COOKIE,
  SESSION_TTL,
  ISSUER_URL,
  type SessionData,
} from "../lib/auth";
import { sendVerificationEmail, sendPasswordResetEmail } from "../emailService";

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

async function upsertUser(claims: Record<string, unknown>) {
  const userData = {
    id: claims.sub as string,
    email: (claims.email as string) || null,
    firstName: (claims.first_name as string) || null,
    lastName: (claims.last_name as string) || null,
    profileImageUrl: (claims.profile_image_url || claims.picture) as
      | string
      | null,
  };

  const [user] = await db
    .insert(usersTable)
    .values(userData)
    .onConflictDoUpdate({
      target: usersTable.id,
      set: {
        ...userData,
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

  const dbUser = await upsertUser(
    claims as unknown as Record<string, unknown>,
  );

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

    const dbUser = await upsertUser(claims as unknown as Record<string, unknown>);

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

      const dbUser = await upsertUser(
        claims as unknown as Record<string, unknown>,
      );

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

function toAuthUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    profileImageUrl: u.profileImageUrl,
  };
}

// ── Tiny in-memory rate limiter (per IP + bucket) ──────────────────────────
const RL_WINDOW_MS = 15 * 60 * 1000;
const rlMap = new Map<string, { count: number; resetAt: number }>();

function rateLimited(req: Request, bucket: string, max: number): boolean {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const entry = rlMap.get(key);
  if (!entry || now > entry.resetAt) {
    rlMap.set(key, { count: 1, resetAt: now + RL_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
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
  if (rateLimited(req, "register", 10)) {
    res.status(429).json({ error: "Too many attempts. Please try again later." });
    return;
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email or password (min 8 characters)." });
    return;
  }
  const email = normalizeEmail(parsed.data.email);
  const { password, phone, firstName, lastName } = parsed.data;

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
    })
    .returning();

  // Fire-and-forget: email confirmation is non-blocking, so registration
  // returns immediately even if SMTP is slow or unavailable. Failures are
  // logged inside sendVerification and the user can resend later.
  void sendVerification(req, user);

  const token = await createSession({ user: toAuthUser(user) });
  res.json({
    token,
    user: toAuthUser(user),
    emailVerified: false,
    phone: user.phone,
  });
});

router.post("/auth/login", async (req: Request, res: Response) => {
  if (rateLimited(req, "login", 20)) {
    res.status(429).json({ error: "Too many attempts. Please try again later." });
    return;
  }
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }
  const email = normalizeEmail(parsed.data.email);

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
  if (sid) await deleteSession(sid);
  res.json({ ok: true });
});

router.get("/auth/me", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
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
  if (rateLimited(req, "resend", 5)) {
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
</style></head><body><div class="card"><div class="brand">Squadz</div>${body}</div></body></html>`;
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

  res.send(htmlPage("Email confirmed", `<h1 class="ok">Email confirmed ✓</h1><p>Your email is verified. You can close this tab and return to the Squadz app.</p>`));
});

router.post("/auth/forgot-password", async (req: Request, res: Response) => {
  if (rateLimited(req, "forgot", 5)) {
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
    if (user && user.passwordHash && user.email) {
      const raw = await issueAuthToken(user.id, "password_reset", PASSWORD_RESET_TTL_MS);
      const resetUrl = `${getOrigin(req)}/api/auth/reset-password?token=${raw}`;
      try {
        await sendPasswordResetEmail({ toEmail: user.email, resetUrl });
      } catch (err) {
        req.log.error({ err }, "Failed to send password reset email");
      }
    }
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
<p>Enter a new password for your Squadz account.</p>
<form method="POST" action="/api/auth/reset-password">
  <input type="hidden" name="token" value="${raw.replace(/"/g, "")}" />
  <input type="password" name="password" placeholder="New password (8+ characters)" minlength="8" required autofocus />
  <button type="submit">Reset Password</button>
</form>`,
    ),
  );
});

router.post("/auth/reset-password", async (req: Request, res: Response) => {
  if (rateLimited(req, "reset", 10)) {
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
    res.send(htmlPage("Password reset", `<h1 class="ok">Password updated ✓</h1><p>Your password has been changed. Open the Squadz app and sign in with your new password.</p>`));
  } else {
    res.json({ ok: true });
  }
});

export default router;
