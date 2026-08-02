// Account-deletion tombstones — deleted credentials must never re-provision
// an account at login.
//
// DELETE /account purges all data and (best-effort) deletes the Supabase auth
// subject. If that external deletion fails, the surviving credentials would
// pass signInWithPassword and the login sync path would upsert a fresh empty
// users row — silently resurrecting the "deleted" account. The tombstone
// written during deletion blocks that path: syncSupabaseUser must reject the
// subject with a plain credential error and re-attempt the auth-subject
// deletion.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const dbMock = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  upsertRows: [] as unknown[],
}));

const supabaseMocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  deleteUser: vi.fn().mockResolvedValue({ data: null, error: null }),
}));

const tombstoneMocks = vi.hoisted(() => ({
  isAnyTombstoned: vi.fn().mockResolvedValue(false),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(dbMock.selectRows),
        limit: () => Promise.resolve(dbMock.selectRows),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(dbMock.upsertRows),
        onConflictDoNothing: () => ({ returning: () => Promise.resolve(dbMock.upsertRows) }),
        onConflictDoUpdate: () => ({ returning: () => Promise.resolve(dbMock.upsertRows) }),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve(dbMock.upsertRows) }) }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
  usersTable: { id: "id", email: "email", emailVerified: "email_verified" },
  sessionsTable: { id: "id" },
  verificationTokensTable: { id: "id" },
}));

vi.mock("../lib/logger");
vi.mock("../services/supabase", () => ({
  supabaseAuth: { auth: { signInWithPassword: supabaseMocks.signInWithPassword } },
  supabaseAdmin: { auth: { admin: { deleteUser: supabaseMocks.deleteUser } } },
}));
// Partial mock: keep the REAL AccountDeletedError class so the route's
// instanceof check works; stub only the tombstone lookup.
vi.mock("../lib/accountTombstones", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/accountTombstones")>();
  return { ...actual, isAnyTombstoned: tombstoneMocks.isAnyTombstoned };
});
vi.mock("../emailService", () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue(null),
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
  },
}));
vi.mock("../services/analytics", () => ({ trackEvent: vi.fn(), identifyUser: vi.fn() }));

import authRouter from "../routes/auth";
import { makeTestApp } from "./helpers/makeTestApp";

const makeApp = () => makeTestApp(authRouter);

const SUBJECT_ID = "deleted-subject-1";

function supabaseLoginSuccess() {
  supabaseMocks.signInWithPassword.mockResolvedValue({
    data: {
      user: { id: SUBJECT_ID, email: "deleted@example.com", user_metadata: {}, app_metadata: {} },
      session: { access_token: "at-1", refresh_token: "rt-1" },
    },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.selectRows = [];
  dbMock.upsertRows = [];
  supabaseMocks.deleteUser.mockResolvedValue({ data: null, error: null });
  tombstoneMocks.isAnyTombstoned.mockResolvedValue(false);
});

describe("POST /api/auth/login — tombstoned (deleted) accounts", () => {
  it("rejects a tombstoned subject with a plain credential error and re-deletes the auth subject", async () => {
    supabaseLoginSuccess();
    tombstoneMocks.isAnyTombstoned.mockResolvedValue(true);

    const res = await request(makeApp())
      .post("/api/auth/login")
      .send({ email: "deleted@example.com", password: "Password1!" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Incorrect email or password.");
    // The straggler auth subject is re-deleted so the credentials die for good.
    expect(supabaseMocks.deleteUser).toHaveBeenCalledWith(SUBJECT_ID);
  });

  it("checks the linked canonical user id too, not just the subject id", async () => {
    supabaseMocks.signInWithPassword.mockResolvedValue({
      data: {
        user: {
          id: SUBJECT_ID,
          email: "deleted@example.com",
          user_metadata: {},
          app_metadata: { linkedUserId: "canonical-user-9" },
        },
        session: { access_token: "at-1", refresh_token: "rt-1" },
      },
      error: null,
    });
    tombstoneMocks.isAnyTombstoned.mockResolvedValue(true);

    const res = await request(makeApp())
      .post("/api/auth/login")
      .send({ email: "deleted@example.com", password: "Password1!" });

    expect(res.status).toBe(401);
    expect(tombstoneMocks.isAnyTombstoned).toHaveBeenCalledWith([SUBJECT_ID, "canonical-user-9"]);
  });

  it("lets a non-tombstoned subject log in normally", async () => {
    supabaseLoginSuccess();
    dbMock.upsertRows = [
      {
        id: SUBJECT_ID,
        email: "deleted@example.com",
        firstName: "Fresh",
        lastName: "User",
        emailVerified: true,
        phone: null,
        friendCode: "FRESH1",
      },
    ];

    const res = await request(makeApp())
      .post("/api/auth/login")
      .send({ email: "deleted@example.com", password: "Password1!" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBe("at-1");
    expect(supabaseMocks.deleteUser).not.toHaveBeenCalled();
  });
});
