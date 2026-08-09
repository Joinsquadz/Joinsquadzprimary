/**
 * Blocking is mutual and severs the private relationship.
 *
 * POST /api/users/:id/block must, in addition to writing the block row:
 *   - delete the symmetric friendship rows (both directions), and
 *   - cancel any pending friend request in either direction,
 * so neither side keeps a live private channel or an acceptable request.
 *
 * GET /api/users/blocks must return display data (name + photo) alongside the
 * ids, because the blocked user's profile endpoint is itself block-gated and
 * the Blocked Users screen would otherwise have nothing to render.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockSelectQueue = vi.hoisted(() => ({ queue: [] as unknown[][] }));
const mockDelete = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockUpdateSet = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => Promise.resolve(mockSelectQueue.queue.shift() ?? []),
        // Some routes select without a where clause.
        then: (resolve: (v: unknown) => void) => resolve(mockSelectQueue.queue.shift() ?? []),
        table,
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => Promise.resolve(undefined),
        returning: () => Promise.resolve([{ id: 1 }]),
      }),
    }),
    delete: (table: unknown) => {
      mockDelete(table);
      return { where: (cond: unknown) => { mockDelete.mock.calls.at(-1)!.push(cond); return Promise.resolve(); } };
    },
    update: (table: unknown) => {
      mockUpdate(table);
      return {
        set: (patch: unknown) => {
          mockUpdateSet(patch);
          return { where: () => Promise.resolve() };
        },
      };
    },
  },
  reportsTable: { id: "id" },
  userBlocksTable: { id: "id", blockerId: "blocker_id", blockedId: "blocked_id" },
  feedPostsTable: { id: "id", status: "status" },
  momentsTable: { id: "id", status: "status" },
  photosTable: { id: "id", status: "status" },
  conversationMessagesTable: { id: "id", status: "status" },
  usersTable: {
    id: "id",
    firstName: "first_name",
    lastName: "last_name",
    profileImageUrl: "profile_image_url",
    moderationHidden: "moderation_hidden",
  },
  planIdeasTable: { id: "id", status: "status" },
  friendshipsTable: { ownerId: "owner_id", friendId: "friend_id" },
  friendRequestsTable: {
    fromUserId: "from_user_id",
    toUserId: "to_user_id",
    status: "status",
  },
}));

vi.mock("../storage", () => ({
  storage: {
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
    canUserViewReportedContent: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock("../lib/logger");
vi.mock("../services/email", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

import moderationRouter from "../routes/moderation";
import { makeTestApp } from "./helpers/makeTestApp";

const ME = "me-1";
const THEM = "them-1";
const authedApp = makeTestApp(moderationRouter, { id: ME });

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectQueue.queue = [];
});

describe("POST /api/users/:id/block — severs the private relationship", () => {
  it("deletes the friendship rows", async () => {
    const res = await request(authedApp).post(`/api/users/${THEM}/block`);

    expect(res.status).toBe(200);
    const deletedTables = mockDelete.mock.calls.map((c) => c[0]);
    expect(deletedTables).toContainEqual({ ownerId: "owner_id", friendId: "friend_id" });
  });

  it("declines any pending friend request in either direction", async () => {
    const res = await request(authedApp).post(`/api/users/${THEM}/block`);

    expect(res.status).toBe(200);
    const updatedTables = mockUpdate.mock.calls.map((c) => c[0]);
    expect(updatedTables).toContainEqual({
      fromUserId: "from_user_id",
      toUserId: "to_user_id",
      status: "status",
    });
    expect(mockUpdateSet).toHaveBeenCalledWith({ status: "declined" });
  });

  it("still refuses to block yourself (no friendship teardown)", async () => {
    const res = await request(authedApp).post(`/api/users/${ME}/block`);

    expect(res.status).toBe(400);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("GET /api/users/blocks — display data for the Blocked Users screen", () => {
  it("returns an empty list without a second query when nothing is blocked", async () => {
    mockSelectQueue.queue = [[]];

    const res = await request(authedApp).get("/api/users/blocks");

    expect(res.status).toBe(200);
    expect(res.body.blockedIds).toEqual([]);
    expect(res.body.blocked).toEqual([]);
  });

  it("returns name and photo for each blocked user", async () => {
    mockSelectQueue.queue = [
      [{ blockedId: "user-a" }, { blockedId: "user-b" }],
      [
        { id: "user-a", firstName: "Ada", lastName: "Lovelace", profileImageUrl: "https://img/a.jpg" },
        { id: "user-b", firstName: "Bo", lastName: null, profileImageUrl: null },
      ],
    ];

    const res = await request(authedApp).get("/api/users/blocks");

    expect(res.status).toBe(200);
    expect(res.body.blockedIds).toEqual(["user-a", "user-b"]);
    expect(res.body.blocked).toEqual([
      { id: "user-a", name: "Ada Lovelace", profileImageUrl: "https://img/a.jpg" },
      { id: "user-b", name: "Bo", profileImageUrl: null },
    ]);
  });

  it("falls back to a neutral label when the user row is gone", async () => {
    mockSelectQueue.queue = [[{ blockedId: "ghost" }], []];

    const res = await request(authedApp).get("/api/users/blocks");

    expect(res.status).toBe(200);
    expect(res.body.blocked).toEqual([
      { id: "ghost", name: "SquadZ user", profileImageUrl: null },
    ]);
  });
});
