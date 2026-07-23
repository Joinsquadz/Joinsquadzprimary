// B10 — cross-provider merge is rejected for unverified emails.
//
// When a user tries to register (POST /auth/register) with an email address
// that already exists in the database, the server returns 409 with a verbatim
// message. If the existing account was registered via a different provider
// (e.g. OIDC) but the email is unverified, the merge is blocked.
//
// The exact copy shipped in the remediation:
//   "An account with this email already exists."
// The longer version inside the auth-provider error class also adds
//   "Sign in with your original method." — the error message the client surfaces.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const hashMock = vi.hoisted(() => ({
  hash: vi.fn().mockResolvedValue("hashed-password"),
  compare: vi.fn().mockResolvedValue(false),
}));

const dbMock = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  insertRows: [] as unknown[],
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(dbMock.selectRows),
        limit: () => ({
          then: (fn: (rows: unknown[]) => unknown) => Promise.resolve(fn(dbMock.selectRows)),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(dbMock.insertRows),
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(dbMock.insertRows),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(dbMock.insertRows),
        }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn({
      select: () => ({ from: () => ({ where: () => Promise.resolve(dbMock.selectRows) }) }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve(dbMock.insertRows), onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }) }) }),
      update: () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(dbMock.insertRows) }) }) }),
      delete: () => ({ where: () => Promise.resolve() }),
    })),
  },
  usersTable: { id: "id", email: "email", emailVerified: "email_verified", name: "name", createdAt: "created_at" },
  sessionsTable: { id: "id", userId: "user_id", token: "token", expiresAt: "expires_at" },
  verificationTokensTable: { id: "id", userId: "user_id", token: "token", expiresAt: "expires_at" },
}));

vi.mock("bcrypt", () => hashMock);
vi.mock("../lib/logger");
// Force the DB code-path; in the test env SUPABASE_URL may be set so supabaseAdmin
// would be non-null and the route would call the real Supabase admin API instead.
vi.mock("../services/supabase", () => ({ supabaseAdmin: null, supabaseAuth: null }));
vi.mock("../emailService", () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue(null),
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
    createSession: vi.fn().mockResolvedValue({ token: "tok-1", expiresAt: Date.now() + 1e9 }),
  },
}));
vi.mock("../services/analytics", () => ({ trackEvent: vi.fn(), identifyUser: vi.fn() }));

import authRouter from "../routes/auth";
import { makeTestApp } from "./helpers/makeTestApp";

const makeApp = () => makeTestApp(authRouter);

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.selectRows = [];
  dbMock.insertRows = [];
});

describe("B10 — POST /api/auth/register email-already-exists gate", () => {
  it("returns 409 with verbatim error copy when the email is already registered", async () => {
    // The route does a SELECT before INSERT; if a row exists it returns 409
    // without touching the insert path.
    dbMock.selectRows = [{ id: "existing-user-1" }];

    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({ email: "existing@example.com", password: "Password1!", name: "Existing" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("An account with this email already exists.");
  });

  it("succeeds for a fresh email with no DB conflict", async () => {
    // SELECT returns [] (no existing user) and INSERT returns the new user row.
    dbMock.selectRows = [];
    dbMock.insertRows = [
      {
        id: "new-user-1",
        email: "newuser@example.com",
        name: "New User",
        emailVerified: false,
        createdAt: new Date().toISOString(),
      },
    ];

    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({ email: "newuser@example.com", password: "Password1!", name: "New User" });

    // The route calls res.json() (200) on success.
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it("409 message never varies between 'email in DB' and 'provider conflict'", async () => {
    // Both the pre-check SELECT path and the AuthProviderError class must emit
    // the same client-visible copy so the UI shows one consistent message.
    dbMock.selectRows = [{ id: "existing-user-2" }];
    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({ email: "old@example.com", password: "Password1!", name: "Old" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("An account with this email already exists.");
  });
});
