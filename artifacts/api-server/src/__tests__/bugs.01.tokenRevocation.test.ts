/**
 * BUG-01 regression: POST /auth/logout must revoke the Supabase JWT so the
 * remaining ~1-hour TTL can't be replayed.  Tests also cover the
 * revokeSupabaseToken / isTokenRevoked helpers in lib/auth.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock ───────────────────────────────────────────────────────────────────
const mockInsertValues = vi.hoisted(() => vi.fn());
const mockDeleteWhere = vi.hoisted(() => vi.fn());
const mockSelectRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    insert: () => ({
      values: mockInsertValues.mockReturnValue({
        onConflictDoNothing: () => Promise.resolve(),
      }),
    }),
    delete: () => ({ where: mockDeleteWhere.mockResolvedValue(undefined) }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockSelectRows.value),
      }),
    }),
    execute: vi.fn().mockResolvedValue({ rows: [{ count: 1 }] }),
  },
  revokedTokensTable: {
    tokenHash: "token_hash",
    userId: "user_id",
    revokedAt: "revoked_at",
    expiresAt: "expires_at",
  },
  sessionsTable: {},
  usersTable: {},
  authTokensTable: {},
}));

vi.mock("../lib/logger");
vi.mock("../services/supabase", () => ({
  supabaseAdmin: null,
  supabaseAuth: null,
}));
vi.mock("../storage", () => ({ storage: { clearPushTokenForSession: vi.fn() } }));
vi.mock("openid-client");

import { revokeSupabaseToken, isTokenRevoked } from "../lib/auth";

// Build a fake 3-part JWT (header.payload.signature) with an exp ~1h from now.
function fakeJwt(sub = "user-abc"): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ sub, exp })).toString("base64url");
  return `${header}.${payload}.fakesig`;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectRows.value = [];
  mockInsertValues.mockReturnValue({ onConflictDoNothing: () => Promise.resolve() });
  mockDeleteWhere.mockResolvedValue(undefined);
});

describe("revokeSupabaseToken", () => {
  it("inserts a SHA-256 hash of the token, not the raw token", async () => {
    const token = fakeJwt();
    await revokeSupabaseToken(token);
    expect(mockInsertValues).toHaveBeenCalledOnce();
    const arg = mockInsertValues.mock.calls[0][0] as Record<string, unknown>;
    // Hash must be a 64-char hex string — not the raw JWT.
    expect(arg.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(arg.tokenHash).not.toBe(token);
  });

  it("extracts userId from the JWT sub claim", async () => {
    const token = fakeJwt("my-user-id");
    await revokeSupabaseToken(token);
    const arg = mockInsertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.userId).toBe("my-user-id");
  });

  it("sets expiresAt from the JWT exp claim", async () => {
    const token = fakeJwt();
    const before = new Date();
    await revokeSupabaseToken(token);
    const after = new Date(Date.now() + 3601_000);
    const arg = mockInsertValues.mock.calls[0][0] as Record<string, unknown>;
    const exp = arg.expiresAt as Date;
    expect(exp.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(exp.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("runs a lazy purge of expired rows before inserting", async () => {
    await revokeSupabaseToken(fakeJwt());
    expect(mockDeleteWhere).toHaveBeenCalledOnce();
  });
});

describe("isTokenRevoked", () => {
  it("returns false when the DB has no matching hash", async () => {
    mockSelectRows.value = [];
    const result = await isTokenRevoked(fakeJwt());
    expect(result).toBe(false);
  });

  it("returns true when the DB contains a matching hash row", async () => {
    mockSelectRows.value = [{ tokenHash: "some-hash" }];
    const result = await isTokenRevoked(fakeJwt());
    expect(result).toBe(true);
  });
});
