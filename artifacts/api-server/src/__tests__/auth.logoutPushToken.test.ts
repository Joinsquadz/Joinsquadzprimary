// C8 — push token removed server-side on logout; no pushes reach a logged-out device.
//
// POST /api/auth/logout must call storage.clearPushTokenForUser(userId) before
// deleting the session so the device's Expo push token is deregistered
// server-side. This is a best-effort cleanup — the logout succeeds regardless
// of whether the token removal succeeds.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const sessionStore = vi.hoisted(() => ({
  sessions: {} as Record<string, { user: { id: string; email: string | null; firstName: string | null; lastName: string | null; profileImageUrl: string | null } }>,
}));

vi.mock("../lib/auth", () => ({
  getSessionId: (req: import("express").Request) => {
    const auth = (req.headers as Record<string, string>)["authorization"];
    if (auth?.startsWith("Bearer ")) return auth.slice(7);
    const cookie = (req.headers as Record<string, string>)["cookie"];
    const match = cookie?.match(/sid=([^;]+)/);
    return match?.[1] ?? null;
  },
  getBearerToken: (req: import("express").Request) => {
    const auth = (req.headers as Record<string, string>)["authorization"];
    if (auth?.startsWith("Bearer ")) return auth.slice(7);
    return undefined;
  },
  getSession: vi.fn(async (sid: string) => sessionStore.sessions[sid] ?? null),
  deleteSession: vi.fn(async (_sid: string) => {}),
  createSession: vi.fn(async () => ({ token: "tok", expiresAt: Date.now() + 1e9 })),
  clearSession: vi.fn(async () => {}),
  getUserFromAccessToken: vi.fn(async () => null),
  getOidcConfig: vi.fn(async () => ({})),
  updateSession: vi.fn(async () => {}),
  hashPassword: vi.fn((_pw: string) => "hashed"),
  verifyPassword: vi.fn(async () => true),
  generateFriendCode: vi.fn(() => "ABC123"),
  // BUG-01: ensure the revocation helpers are present so logout doesn't throw
  // even if a Supabase JWT is somehow presented in tests.
  revokeSupabaseToken: vi.fn(async () => {}),
  isTokenRevoked: vi.fn(async () => false),
}));

vi.mock("../storage", () => ({
  storage: {
    clearPushTokenForUser: vi.fn().mockResolvedValue(undefined),
    getUser: vi.fn().mockResolvedValue(null),
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
    createSession: vi.fn().mockResolvedValue({ token: "tok", expiresAt: Date.now() + 1e9 }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) }),
    delete: () => ({ where: () => Promise.resolve() }),
    transaction: vi.fn().mockResolvedValue(undefined),
  },
  usersTable: { id: "id", email: "email", passwordHash: "password_hash", name: "name" },
  sessionsTable: { id: "id", userId: "user_id", token: "token", expiresAt: "expires_at" },
  deviceTokensTable: { userId: "user_id", token: "token" },
}));

vi.mock("../lib/logger");
vi.mock("../services/supabase", () => ({ supabaseAdmin: null, supabaseAuth: null }));
vi.mock("../services/analytics", () => ({ trackEvent: vi.fn(), identifyUser: vi.fn() }));
vi.mock("../emailService", () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
}));

import authRouter from "../routes/auth";
import { makeTestApp } from "./helpers/makeTestApp";
import { getSession, deleteSession } from "../lib/auth";
import { storage } from "../storage";

const makeApp = () => makeTestApp(authRouter);

beforeEach(() => {
  sessionStore.sessions = {};
  vi.clearAllMocks();
});

describe("C8 — POST /api/auth/logout clears push token server-side", () => {
  it("calls clearPushTokenForUser with the session's userId before deleting the session", async () => {
    sessionStore.sessions["session-abc"] = {
      user: { id: "user-1", email: "alice@example.com", firstName: null, lastName: null, profileImageUrl: null },
    };
    vi.mocked(getSession).mockImplementation(async (sid) =>
      sessionStore.sessions[sid] ?? null,
    );

    const res = await request(makeApp())
      .post("/api/auth/logout")
      .set("Authorization", "Bearer session-abc");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(storage.clearPushTokenForUser).toHaveBeenCalledWith("user-1");
  });

  it("deletes the session after clearing the push token", async () => {
    sessionStore.sessions["session-abc"] = {
      user: { id: "user-1", email: "alice@example.com", firstName: null, lastName: null, profileImageUrl: null },
    };
    vi.mocked(getSession).mockImplementation(async (sid) =>
      sessionStore.sessions[sid] ?? null,
    );

    await request(makeApp())
      .post("/api/auth/logout")
      .set("Authorization", "Bearer session-abc");

    expect(deleteSession).toHaveBeenCalledWith("session-abc");
  });

  it("does NOT call clearPushTokenForUser when no session id is present", async () => {
    const res = await request(makeApp()).post("/api/auth/logout");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(storage.clearPushTokenForUser).not.toHaveBeenCalled();
  });

  it("still returns { ok: true } even when the session is not found in the store", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const res = await request(makeApp())
      .post("/api/auth/logout")
      .set("Authorization", "Bearer unknown-session");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(storage.clearPushTokenForUser).not.toHaveBeenCalled();
  });
});
