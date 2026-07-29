import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── DB mock wiring ────────────────────────────────────────────────────────────
// Shared mutable containers so individual tests can control what the DB returns
// without redefining the mock.

/** What SELECT queries return (default empty — no rows). */
const mockSelectRows = vi.hoisted(() => ({ value: [] as unknown[] }));
/** What INSERT … RETURNING returns (default: the inserted row, simulating success). */
const mockInsertRows = vi.hoisted(() => ({
  value: [{ id: 42 }] as unknown[],
}));
/** Spy so tests can assert the UPDATE was called for auto-hide. */
const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockSelectRows.value),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(mockInsertRows.value),
          // for inserts without .returning()
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        }),
        // for inserts without .onConflictDoNothing() (none currently, but guard)
        returning: () => Promise.resolve(mockInsertRows.value),
      }),
    }),
    update: mockUpdate,
    delete: () => ({
      where: () => Promise.resolve(),
    }),
  },
  reportsTable: {
    reporterId: "reporter_id",
    contentType: "content_type",
    contentId: "content_id",
    targetUserId: "target_user_id",
    reason: "reason",
    notes: "notes",
    id: "id",
  },
  userBlocksTable: {
    blockerId: "blocker_id",
    blockedId: "blocked_id",
  },
  feedPostsTable: {
    id: "id",
    status: "status",
  },
  momentsTable: {
    id: "id",
    status: "status",
  },
  photosTable: {
    id: "id",
    status: "status",
  },
  // BUG-02: new hideable content types
  conversationMessagesTable: {
    id: "id",
    status: "status",
  },
  usersTable: {
    id: "id",
    moderationHidden: "moderation_hidden",
  },
}));

vi.mock("../storage", () => ({
  storage: {
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
    // SEC-01: default to visible so existing tests are unaffected.
    canUserViewReportedContent: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("../lib/logger");
vi.mock("../services/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

// Static imports below vi.mock — see .agents/memory/api-server-test-cold-import.md
import moderationRouter from "../routes/moderation";
import { makeTestApp } from "./helpers/makeTestApp";

const REPORTER_ID = "reporter-user-id";
const TARGET_ID = "target-user-id";

const authedApp = makeTestApp(moderationRouter, { id: REPORTER_ID });
const anonApp = makeTestApp(moderationRouter);

// ── POST /api/reports ─────────────────────────────────────────────────────────
describe("POST /api/reports", () => {
  beforeEach(() => {
    mockSelectRows.value = [];
    mockInsertRows.value = [{ id: 42 }];
    mockUpdate.mockReset();
    mockUpdate.mockReturnValue({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    });
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(anonApp).post("/api/reports").send({
      contentType: "post",
      contentId: "post-1",
      targetUserId: TARGET_ID,
      reason: "spam",
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid contentType", async () => {
    const res = await request(authedApp).post("/api/reports").send({
      contentType: "invalid_type",
      contentId: "post-1",
      targetUserId: TARGET_ID,
      reason: "spam",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid reason", async () => {
    const res = await request(authedApp).post("/api/reports").send({
      contentType: "post",
      contentId: "post-1",
      targetUserId: TARGET_ID,
      reason: "not_a_real_reason",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when reporter targets themselves", async () => {
    const res = await request(authedApp).post("/api/reports").send({
      contentType: "post",
      contentId: "post-1",
      targetUserId: REPORTER_ID,
      reason: "spam",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/yourself/i);
  });

  it.each([
    ["post", "spam"],
    ["moment", "harassment"],
    ["message", "inappropriate_content"],
    ["photo", "other"],
    ["profile", "spam"],
  ] as const)(
    "returns 200 for valid contentType=%s reason=%s",
    async (contentType, reason) => {
      const res = await request(authedApp).post("/api/reports").send({
        contentType,
        contentId: "content-abc",
        targetUserId: TARGET_ID,
        reason,
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    },
  );

  it("returns 200 (idempotent) when duplicate report is silently ignored", async () => {
    // onConflictDoNothing returns no row — simulates a duplicate
    mockInsertRows.value = [];
    const res = await request(authedApp).post("/api/reports").send({
      contentType: "post",
      contentId: "post-1",
      targetUserId: TARGET_ID,
      reason: "spam",
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("does NOT auto-hide when fewer than 3 distinct reporters", async () => {
    // SELECT returns 2 rows (below threshold)
    mockSelectRows.value = [{ reporterId: "u1" }, { reporterId: "u2" }];
    await request(authedApp).post("/api/reports").send({
      contentType: "post",
      contentId: "post-1",
      targetUserId: TARGET_ID,
      reason: "spam",
    });
    // Flush async
    await new Promise((r) => setTimeout(r, 20));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("auto-hides post when 3 distinct reporters submit reports", async () => {
    // SELECT returns 3 distinct reporter rows — triggers auto-hide
    mockSelectRows.value = [
      { reporterId: "u1" },
      { reporterId: "u2" },
      { reporterId: "u3" },
    ];
    await request(authedApp).post("/api/reports").send({
      contentType: "post",
      contentId: "post-1",
      targetUserId: TARGET_ID,
      reason: "spam",
    });
    // Flush the fire-and-forget async maybeAutoHide
    await new Promise((r) => setTimeout(r, 20));
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("auto-hides moment when threshold is reached", async () => {
    mockSelectRows.value = [
      { reporterId: "u1" },
      { reporterId: "u2" },
      { reporterId: "u3" },
    ];
    await request(authedApp).post("/api/reports").send({
      contentType: "moment",
      contentId: "moment-xyz",
      targetUserId: TARGET_ID,
      reason: "inappropriate_content",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mockUpdate).toHaveBeenCalled();
  });

  // BUG-02: message and profile types are now auto-hidden at the 3-reporter threshold.
  it("BUG-02: auto-hides a message when 3 distinct reporters flag it", async () => {
    mockSelectRows.value = [
      { reporterId: "u1" },
      { reporterId: "u2" },
      { reporterId: "u3" },
    ];
    await request(authedApp).post("/api/reports").send({
      contentType: "message",
      contentId: "msg-1",
      targetUserId: TARGET_ID,
      reason: "harassment",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("BUG-02: auto-hides a user profile when 3 distinct reporters flag it", async () => {
    mockSelectRows.value = [
      { reporterId: "u1" },
      { reporterId: "u2" },
      { reporterId: "u3" },
    ];
    await request(authedApp).post("/api/reports").send({
      contentType: "profile",
      contentId: TARGET_ID,
      targetUserId: TARGET_ID,
      reason: "spam",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("BUG-07: accepts 'profile' as a valid contentType (enum check)", async () => {
    const res = await request(authedApp).post("/api/reports").send({
      contentType: "profile",
      contentId: TARGET_ID,
      targetUserId: TARGET_ID,
      reason: "spam",
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── GET /api/users/blocks ─────────────────────────────────────────────────────
describe("GET /api/users/blocks", () => {
  beforeEach(() => {
    mockSelectRows.value = [];
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(anonApp).get("/api/users/blocks");
    expect(res.status).toBe(401);
  });

  it("returns 200 with empty blockedIds when nothing blocked", async () => {
    mockSelectRows.value = [];
    const res = await request(authedApp).get("/api/users/blocks");
    expect(res.status).toBe(200);
    expect(res.body.blockedIds).toEqual([]);
  });

  it("returns 200 with the blocked user IDs", async () => {
    mockSelectRows.value = [
      { blockedId: "user-a" },
      { blockedId: "user-b" },
    ];
    const res = await request(authedApp).get("/api/users/blocks");
    expect(res.status).toBe(200);
    expect(res.body.blockedIds).toEqual(["user-a", "user-b"]);
  });
});

// ── POST /api/users/:id/block ─────────────────────────────────────────────────
describe("POST /api/users/:id/block", () => {
  beforeEach(() => {
    mockUpdate.mockReset();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(anonApp).post(`/api/users/${TARGET_ID}/block`);
    expect(res.status).toBe(401);
  });

  it("returns 400 when blocking yourself", async () => {
    const res = await request(authedApp).post(`/api/users/${REPORTER_ID}/block`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/yourself/i);
  });

  it("returns 200 on valid block", async () => {
    const res = await request(authedApp).post(`/api/users/${TARGET_ID}/block`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 200 (idempotent) when already blocked", async () => {
    // First block
    await request(authedApp).post(`/api/users/${TARGET_ID}/block`);
    // Second block should not error
    const res = await request(authedApp).post(`/api/users/${TARGET_ID}/block`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── DELETE /api/users/:id/block ───────────────────────────────────────────────
describe("DELETE /api/users/:id/block", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(anonApp).delete(`/api/users/${TARGET_ID}/block`);
    expect(res.status).toBe(401);
  });

  it("returns 200 on valid unblock", async () => {
    const res = await request(authedApp).delete(`/api/users/${TARGET_ID}/block`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// GET /api/users/:id/block block-status tests live in moderation.blockStatus.test.ts
// (isolated file — avoids a module-context collision in the 62-file parallel run).
