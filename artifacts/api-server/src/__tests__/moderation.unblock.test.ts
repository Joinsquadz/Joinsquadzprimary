import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── DB mock state ─────────────────────────────────────────────────────────────

const mockSelectRows = vi.hoisted(() => ({ value: [] as unknown[] }));

// Track every delete call so we can assert what tables were targeted.
const mockDeleteCalls = vi.hoisted(() => ({ tables: [] as unknown[] }));
// Track every insert call so we can assert friendship is never re-inserted.
const mockInsertCalls = vi.hoisted(() => ({ tables: [] as unknown[] }));
// Track every update call (friend-request status → "declined" on block).
const mockUpdateCalls = vi.hoisted(() => ({ tables: [] as unknown[] }));

vi.mock("@workspace/db", () => {
  // Table sentinel objects — we compare by reference in assertions.
  const userBlocksTable = { _name: "user_blocks", blockerId: "blocker_id", blockedId: "blocked_id" };
  const friendshipsTable = { _name: "friendships", ownerId: "owner_id", friendId: "friend_id" };
  const friendRequestsTable = {
    _name: "friend_requests",
    fromUserId: "from_user_id",
    toUserId: "to_user_id",
    status: "status",
  };
  const usersTable = { _name: "users", id: "id", firstName: "first_name", lastName: "last_name", profileImageUrl: "profile_image_url" };
  const reportsTable = { _name: "reports", reporterId: "reporter_id", contentType: "content_type", contentId: "content_id" };
  const feedPostsTable = { _name: "feed_posts" };
  const momentsTable = { _name: "moments" };
  const photosTable = { _name: "photos" };
  const conversationMessagesTable = { _name: "conversation_messages" };
  const planIdeasTable = { _name: "plan_ideas" };
  const eventInvitesTable = { _name: "event_invites", id: "id", inviterUserId: "inviter_user_id", invitedUserId: "invited_user_id", status: "status" };
  const activityTable = { _name: "activity", type: "type", subjectId: "subject_id" };

  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockSelectRows.value),
        orderBy: () => Promise.resolve(mockSelectRows.value),
      }),
    }),
    delete: (table: unknown) => {
      mockDeleteCalls.tables.push(table);
      return { where: () => Promise.resolve() };
    },
    insert: (table: unknown) => {
      mockInsertCalls.tables.push(table);
      return {
        values: () => ({
          onConflictDoNothing: () => Promise.resolve(),
          returning: () => Promise.resolve([{ id: "new-row-id" }]),
        }),
      };
    },
    update: (table: unknown) => {
      mockUpdateCalls.tables.push(table);
      return {
        set: () => ({
          where: () => Promise.resolve(),
        }),
      };
    },
    execute: () => Promise.resolve(),
  };
  (db as any).transaction = async (callback: (tx: typeof db) => unknown) => callback(db);

  return {
    db,
    userBlocksTable,
    friendshipsTable,
    friendRequestsTable,
    usersTable,
    reportsTable,
    feedPostsTable,
    momentsTable,
    photosTable,
    conversationMessagesTable,
    planIdeasTable,
    eventInvitesTable,
    activityTable,
  };
});

vi.mock("../storage", () => ({
  storage: {
    canUserViewReportedContent: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("../services/email", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/logger");

import moderationRouter from "../routes/moderation";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

// Re-import the table sentinels for reference comparisons.
import { friendshipsTable, friendRequestsTable, userBlocksTable } from "@workspace/db";

const BLOCKER_ID = "blocker-user-id";
const TARGET_ID = "target-user-id";

const makeApp = (user?: TestUser) => makeTestApp(moderationRouter, user);

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectRows.value = [];
  mockDeleteCalls.tables = [];
  mockInsertCalls.tables = [];
  mockUpdateCalls.tables = [];
});

// ── POST /api/users/:id/block ─────────────────────────────────────────────────

describe("POST /api/users/:id/block", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp()).post(`/api/users/${TARGET_ID}/block`);
    expect(res.status).toBe(401);
  });

  it("returns 400 when blocking yourself", async () => {
    const res = await request(makeApp({ id: BLOCKER_ID })).post(`/api/users/${BLOCKER_ID}/block`);
    expect(res.status).toBe(400);
  });

  it("returns 200 ok and inserts the block row", async () => {
    const res = await request(makeApp({ id: BLOCKER_ID })).post(`/api/users/${TARGET_ID}/block`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockInsertCalls.tables).toContain(userBlocksTable);
  });

  it("deletes friendship rows in both directions", async () => {
    await request(makeApp({ id: BLOCKER_ID })).post(`/api/users/${TARGET_ID}/block`);
    // friendshipsTable is deleted during block.
    expect(mockDeleteCalls.tables).toContain(friendshipsTable);
  });

  it("marks pending friend requests as declined", async () => {
    await request(makeApp({ id: BLOCKER_ID })).post(`/api/users/${TARGET_ID}/block`);
    expect(mockUpdateCalls.tables).toContain(friendRequestsTable);
  });
});

// ── DELETE /api/users/:id/block ───────────────────────────────────────────────

describe("DELETE /api/users/:id/block", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp()).delete(`/api/users/${TARGET_ID}/block`);
    expect(res.status).toBe(401);
  });

  it("returns 200 ok after unblocking", async () => {
    const res = await request(makeApp({ id: BLOCKER_ID })).delete(
      `/api/users/${TARGET_ID}/block`,
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("deletes the block row on unblock", async () => {
    await request(makeApp({ id: BLOCKER_ID })).delete(`/api/users/${TARGET_ID}/block`);
    expect(mockDeleteCalls.tables).toContain(userBlocksTable);
  });

  it("does NOT insert any friendship rows after unblocking", async () => {
    await request(makeApp({ id: BLOCKER_ID })).delete(`/api/users/${TARGET_ID}/block`);
    // No insert should have happened at all — friendship is NOT silently restored.
    expect(mockInsertCalls.tables).not.toContain(friendshipsTable);
    expect(mockInsertCalls.tables.length).toBe(0);
  });

  it("does NOT insert any friend-request rows after unblocking", async () => {
    await request(makeApp({ id: BLOCKER_ID })).delete(`/api/users/${TARGET_ID}/block`);
    expect(mockInsertCalls.tables).not.toContain(friendRequestsTable);
  });
});

// ── Full block → unblock flow ─────────────────────────────────────────────────

describe("block → unblock flow: friendship is severed and not restored", () => {
  it("block severs friendship; subsequent unblock does not re-insert it", async () => {
    const app = makeApp({ id: BLOCKER_ID });

    // Step 1: Block.
    const blockRes = await request(app).post(`/api/users/${TARGET_ID}/block`);
    expect(blockRes.status).toBe(200);

    // Friendship was deleted during block.
    expect(mockDeleteCalls.tables).toContain(friendshipsTable);

    // Reset call tracking to isolate the unblock step.
    mockDeleteCalls.tables = [];
    mockInsertCalls.tables = [];
    mockUpdateCalls.tables = [];

    // Step 2: Unblock.
    const unblockRes = await request(app).delete(`/api/users/${TARGET_ID}/block`);
    expect(unblockRes.status).toBe(200);

    // The block row is removed.
    expect(mockDeleteCalls.tables).toContain(userBlocksTable);

    // Critically: no friendship row is inserted — the "Add friend" CTA is
    // correct to show "add" (not "remove") after unblocking.
    expect(mockInsertCalls.tables).not.toContain(friendshipsTable);
    expect(mockInsertCalls.tables).not.toContain(friendRequestsTable);
    expect(mockInsertCalls.tables.length).toBe(0);
  });
});
