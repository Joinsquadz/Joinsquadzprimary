/**
 * 13+ age gate on POST /api/auth/register.
 *
 * The client shows a date-of-birth picker, but the server is the enforcement
 * point — a direct API call with an under-13 DOB (or none at all) must fail.
 *
 * Also asserts the data-minimization rule: only the derived marker and the
 * birth year are persisted, never the exact date of birth.
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

/** A DOB comfortably over 13, computed relative to today so it never expires. */
function adultDob(): string {
  const d = new Date();
  return `${d.getFullYear() - 30}-06-15`;
}

/** A DOB for someone who turns 13 tomorrow — still 12 today. */
function almostThirteenDob(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear() - 13;
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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
  it("rejects a signup with no date of birth (400 DOB_REQUIRED)", async () => {
    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({ email: "nodob@example.com", password: "Password1!", name: "No Dob" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DOB_REQUIRED");
    expect(dbMock.insertedValues).toHaveLength(0);
  });

  it("rejects a malformed date of birth (400 DOB_INVALID)", async () => {
    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({
        email: "bad@example.com",
        password: "Password1!",
        name: "Bad Dob",
        dateOfBirth: "not-a-date",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DOB_INVALID");
    expect(dbMock.insertedValues).toHaveLength(0);
  });

  it("rejects an impossible calendar date (400 DOB_INVALID)", async () => {
    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({
        email: "feb30@example.com",
        password: "Password1!",
        name: "Feb Thirty",
        dateOfBirth: "2000-02-30",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DOB_INVALID");
  });

  it("rejects a future date of birth (400 DOB_INVALID)", async () => {
    const next = new Date();
    next.setFullYear(next.getFullYear() + 1);
    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({
        email: "future@example.com",
        password: "Password1!",
        name: "Future Kid",
        dateOfBirth: `${next.getFullYear()}-01-01`,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DOB_INVALID");
  });

  it("rejects an under-13 signup with 403 UNDER_MIN_AGE and creates no account", async () => {
    const d = new Date();
    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({
        email: "kid@example.com",
        password: "Password1!",
        name: "Young Kid",
        dateOfBirth: `${d.getFullYear() - 9}-03-02`,
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("UNDER_MIN_AGE");
    expect(res.body.error).toMatch(/13/);
    expect(dbMock.insertedValues).toHaveLength(0);
  });

  it("rejects someone who turns 13 tomorrow (birthday must have passed)", async () => {
    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({
        email: "almost@example.com",
        password: "Password1!",
        name: "Almost Thirteen",
        dateOfBirth: almostThirteenDob(),
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("UNDER_MIN_AGE");
  });

  it("accepts a 13+ signup and stores only the marker + birth year (never the DOB)", async () => {
    const dob = adultDob();
    const res = await request(makeApp())
      .post("/api/auth/register")
      .send({
        email: "grown@example.com",
        password: "Password1!",
        name: "Grown Up",
        dateOfBirth: dob,
      });

    expect(res.status).toBe(200);

    const userInsert = dbMock.insertedValues.find((v) => "email" in v);
    expect(userInsert).toBeDefined();
    expect(userInsert!.meetsMinAge).toBe(true);
    expect(userInsert!.birthYear).toBe(Number(dob.slice(0, 4)));
    // Data minimization: the exact day/month must not be persisted anywhere.
    const serialized = JSON.stringify(dbMock.insertedValues);
    expect(serialized).not.toContain(dob);
    expect(Object.keys(userInsert!)).not.toContain("dateOfBirth");
  });
});
