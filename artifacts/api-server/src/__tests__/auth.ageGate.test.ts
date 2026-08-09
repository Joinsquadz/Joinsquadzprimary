/**
 * 13+ age gate on POST /api/auth/register.
 *
 * The client collects a birth year, but the server is the enforcement point —
 * a direct API call with an under-13 year (or none at all) must fail.
 *
 * Also asserts the data-minimization rule: only the derived marker and the
 * birth year are persisted, never an exact date of birth.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const hashMock = vi.hoisted(() => ({
  hash: vi.fn().mockResolvedValue("hashed-password"),
  compare: vi.fn().mockResolvedValue(false),
}));

const dbMock = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  insertRows: [] as unknown[],
  /** Every values() payload handed to an INSERT, so we can assert what's stored. */
  insertedValues: [] as Record<string, unknown>[],
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
      values: (v: Record<string, unknown>) => {
        dbMock.insertedValues.push(v);
        return {
          returning: () => Promise.resolve(dbMock.insertRows),
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(dbMock.insertRows),
          }),
        };
      },
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve(dbMock.insertRows) }) }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  },
  usersTable: { id: "id", email: "email", emailVerified: "email_verified", createdAt: "created_at" },
  sessionsTable: { id: "id", userId: "user_id", token: "token", expiresAt: "expires_at" },
  authTokensTable: { id: "id", userId: "user_id" },
}));

vi.mock("bcrypt", () => hashMock);
vi.mock("../lib/logger");
// Force the DB signup path (no Supabase) so the insert payload is observable.
vi.mock("../services/supabase", () => ({ supabaseAdmin: null, supabaseAuth: null }));
vi.mock("../emailService", () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
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
  dbMock.insertedValues = [];
  dbMock.insertRows = [
    {
      id: "new-user-1",
      email: "kid@example.com",
      emailVerified: false,
      createdAt: new Date().toISOString(),
    },
  ];
});

describe("POST /api/auth/register — 13+ age gate", () => {
  it("rejects a signup with no birth year (400 BIRTH_YEAR_REQUIRED)", async () => {
    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({ email: "nodob@example.com", password: "Password1!", name: "No Dob" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BIRTH_YEAR_REQUIRED");
    expect(dbMock.insertedValues).toHaveLength(0);
  });

  it("rejects a malformed birth year (400 BIRTH_YEAR_INVALID)", async () => {
    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({
        email: "bad@example.com",
        password: "Password1!",
        name: "Bad Year",
        birthYear: "not-a-year",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BIRTH_YEAR_INVALID");
    expect(dbMock.insertedValues).toHaveLength(0);
  });

  it("rejects an implausibly old birth year (400 BIRTH_YEAR_INVALID)", async () => {
    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({
        email: "old@example.com",
        password: "Password1!",
        name: "Too Old",
        birthYear: "1899",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BIRTH_YEAR_INVALID");
  });

  it("rejects a future birth year (400 BIRTH_YEAR_INVALID)", async () => {
    const next = new Date();
    next.setFullYear(next.getFullYear() + 1);
    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({
        email: "future@example.com",
        password: "Password1!",
        name: "Future Person",
        birthYear: `${next.getFullYear()}`,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BIRTH_YEAR_INVALID");
  });

  it("rejects an under-13 signup with 403 UNDER_MIN_AGE and creates no account", async () => {
    const d = new Date();
    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({
        email: "kid@example.com",
        password: "Password1!",
        name: "Young Kid",
        birthYear: `${d.getFullYear() - 9}`,
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("UNDER_MIN_AGE");
    expect(res.body.error).toMatch(/13/);
    expect(dbMock.insertedValues).toHaveLength(0);
  });

  it("accepts the newest eligible birth year without collecting an exact birthday", async () => {
    const year = new Date().getFullYear() - 13;
    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({
        email: "newest-eligible@example.com",
        password: "Password1!",
        name: "Newest Eligible",
        birthYear: `${year}`,
      });

    expect(res.status).toBe(200);
  });

  it("accepts a 13+ signup and stores only the marker + birth year", async () => {
    const birthYear = `${new Date().getFullYear() - 30}`;
    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({
        email: "grown@example.com",
        password: "Password1!",
        name: "Grown Up",
        birthYear,
      });

    expect(res.status).toBe(200);

    const userInsert = dbMock.insertedValues.find((v) => "email" in v);
    expect(userInsert).toBeDefined();
    expect(userInsert!.meetsMinAge).toBe(true);
    expect(userInsert!.birthYear).toBe(Number(birthYear));
    // Data minimization: no exact date-of-birth field is persisted anywhere.
    const serialized = JSON.stringify(dbMock.insertedValues);
    expect(Object.keys(userInsert!)).not.toContain("dateOfBirth");
  });
});
