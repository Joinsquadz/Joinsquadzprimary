/**
 * BUG-04 regression: the register / login / resend / forgot / reset rate
 * limiters are now Postgres-backed so they survive server restarts and work
 * across multiple instances.  These tests verify that:
 *   1. A count ≤ max allows the request through (200 / 201 expected).
 *   2. A count > max blocks the request (429 expected).
 *   3. A DB error is handled gracefully (request allowed, not blocked).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── DB mock ───────────────────────────────────────────────────────────────────
// Control the `count` returned by the rate-limit UPSERT RETURNING query.
const dbExecuteResult = vi.hoisted(() => ({ count: 1 }));

vi.mock("@workspace/db", () => ({
  db: {
    execute: vi.fn(async () => ({ rows: [dbExecuteResult] })),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
        orderBy: () => Promise.resolve([]),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
        returning: () => Promise.resolve([]),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    }),
  },
  usersTable: {
    id: "id",
    email: "email",
    passwordHash: "password_hash",
    firstName: "first_name",
    lastName: "last_name",
    phone: "phone",
    isSquadzPlus: "is_squadz_plus",
    emailVerified: "email_verified",
    moderationHidden: "moderation_hidden",
  },
  sessionsTable: {},
  authTokensTable: { token: "token", expiresAt: "expires_at", userId: "user_id", type: "type" },
  revokedTokensTable: {},
}));

vi.mock("../lib/logger");
vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return {
    ...actual,
    revokeSupabaseToken: vi.fn(),
    getOidcConfig: vi.fn(),
  };
});
vi.mock("../services/supabase", () => ({
  supabaseAdmin: null,
  supabaseAuth: { signUp: vi.fn(), signInWithPassword: vi.fn() },
}));
vi.mock("../services/analytics", () => ({ trackEvent: vi.fn(), identifyUser: vi.fn() }));
vi.mock("../emailService", () => ({
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn(),
    upsertUser: vi.fn(),
    clearPushTokenForSession: vi.fn(),
  },
}));

import authRouter from "../routes/auth";
import { makeTestApp } from "./helpers/makeTestApp";

const app = makeTestApp(authRouter);

beforeEach(() => {
  vi.clearAllMocks();
  dbExecuteResult.count = 1;
});

describe("BUG-04: DB-backed rate limiter", () => {
  it("allows requests when count is within the limit", async () => {
    dbExecuteResult.count = 5; // well under register max (10)
    const res = await request(app).post("/api/auth/register").send({
      email: "test@example.com",
      password: "password123",
      firstName: "Test",
    });
    // 400 (validation/duplicate) is fine — important thing is NOT 429.
    expect(res.status).not.toBe(429);
  });

  it("returns 429 when the DB count exceeds the register limit (10)", async () => {
    dbExecuteResult.count = 11; // over the register limit
    const res = await request(app).post("/api/auth/register").send({
      email: "test@example.com",
      password: "password123",
      firstName: "Test",
    });
    expect(res.status).toBe(429);
  });

  it("returns 429 when the DB count exceeds the login limit (20)", async () => {
    dbExecuteResult.count = 21;
    const res = await request(app).post("/api/auth/login").send({
      email: "test@example.com",
      password: "password123",
    });
    expect(res.status).toBe(429);
  });

  it("allows the request (does not 429) when the DB execute throws", async () => {
    const { db } = await import("@workspace/db");
    vi.mocked(db.execute).mockRejectedValueOnce(new Error("DB unavailable"));
    dbExecuteResult.count = 99; // Would be over limit, but error should fallback to allow
    const res = await request(app).post("/api/auth/register").send({
      email: "test@example.com",
      password: "password123",
      firstName: "Test",
    });
    // Should NOT be blocked by rate limiter when DB fails
    expect(res.status).not.toBe(429);
  });
});
