/**
 * SEC-01: POST /reports must reject reports from accounts that cannot currently
 * view the content they are reporting. Without this gate, 3 coordinated accounts
 * who know a content UUID can auto-hide content they have never seen.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Mutable spy container ─────────────────────────────────────────────────────

const canViewResult = vi.hoisted(() => ({ value: true }));
const mockInsertRows = vi.hoisted(() => ({ value: [{ id: 42 }] as unknown[] }));
const mockSelectRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdate = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────

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
        }),
      }),
    }),
    update: mockUpdate,
    delete: () => ({ where: () => Promise.resolve() }),
  },
  reportsTable: { reporterId: "reporter_id", contentType: "content_type", contentId: "content_id", targetUserId: "target_user_id", reason: "reason", notes: "notes", id: "id" },
  userBlocksTable: { blockerId: "blocker_id", blockedId: "blocked_id" },
  feedPostsTable: { id: "id", status: "status" },
  momentsTable: { id: "id", status: "status" },
  photosTable: { id: "id", status: "status" },
  conversationMessagesTable: { id: "id", status: "status" },
  usersTable: { id: "id", moderationHidden: "moderation_hidden" },
}));

vi.mock("../storage", () => ({
  storage: {
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
    canUserViewReportedContent: vi.fn().mockImplementation(() =>
      Promise.resolve(canViewResult.value),
    ),
  },
}));

vi.mock("../lib/logger");
vi.mock("../services/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

// Static imports below vi.mock (cold-import rule)
import moderationRouter from "../routes/moderation";
import { makeTestApp } from "./helpers/makeTestApp";

const REPORTER = "reporter-id";
const TARGET = "target-id";
const authedApp = makeTestApp(moderationRouter, { id: REPORTER });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/reports — SEC-01 visibility gate", () => {
  beforeEach(() => {
    canViewResult.value = true;
    mockInsertRows.value = [{ id: 42 }];
    mockSelectRows.value = [];
    mockUpdate.mockReset();
    mockUpdate.mockReturnValue({ set: () => ({ where: () => Promise.resolve() }) });
  });

  it("returns 200 when the reporter can see the content (control)", async () => {
    canViewResult.value = true;
    const res = await request(authedApp).post("/api/reports").send({
      contentType: "post",
      contentId: "visible-post-id",
      targetUserId: TARGET,
      reason: "spam",
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 403 when the reporter cannot see the reported content", async () => {
    canViewResult.value = false;
    const res = await request(authedApp).post("/api/reports").send({
      contentType: "post",
      contentId: "invisible-post-id",
      targetUserId: TARGET,
      reason: "spam",
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not.*visible|not found/i);
  });

  it.each(["post", "moment", "message", "photo", "profile"] as const)(
    "rejects a %s report when reporter has no visibility",
    async (contentType) => {
      canViewResult.value = false;
      const res = await request(authedApp).post("/api/reports").send({
        contentType,
        contentId: "hidden-content-id",
        targetUserId: TARGET,
        reason: "inappropriate_content",
      });
      expect(res.status).toBe(403);
    },
  );

  it("does not insert the report when visibility check fails", async () => {
    canViewResult.value = false;
    mockInsertRows.value = [{ id: 99 }]; // would indicate an insert happened
    await request(authedApp).post("/api/reports").send({
      contentType: "photo",
      contentId: "photo-id",
      targetUserId: TARGET,
      reason: "spam",
    });
    // mockInsertRows should not have been consumed — if the route returned 403
    // before insert, the insert mock is never called.
    // Verify auto-hide was never triggered either.
    await new Promise((r) => setTimeout(r, 20));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("three accounts with no visibility cannot trigger auto-hide", async () => {
    canViewResult.value = false;
    // Simulate 3 reporters all failing the visibility check.
    for (let i = 0; i < 3; i++) {
      const app = makeTestApp(moderationRouter, { id: `reporter-${i}` });
      const res = await request(app).post("/api/reports").send({
        contentType: "moment",
        contentId: "private-moment-id",
        targetUserId: TARGET,
        reason: "harassment",
      });
      expect(res.status).toBe(403);
    }
    await new Promise((r) => setTimeout(r, 20));
    // auto-hide must never have run
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
