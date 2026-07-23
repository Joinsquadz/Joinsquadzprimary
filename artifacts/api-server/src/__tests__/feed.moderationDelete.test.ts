// B3 — host/co-admin moderation delete for Feed posts and Moments.
// Authorization matrix:
//   author        → 200 (always)
//   squad host    → 200 (moderation delete on squad-scoped content)
//   squad co-admin → 200 (moderation delete on squad-scoped content)
//   unrelated member → 403
//   friends-scoped post, non-author → 403 (no moderation delete for friends posts)
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockFeedRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockSquadRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockMomentRows = vi.hoisted(() => ({ value: [] as unknown[] }));

// Chainable thenable so .from().where() and .from().where().innerJoin() all resolve.
function makeChainable(getValue: () => unknown[]): Record<string, unknown> {
  const self: Record<string, unknown> = {
    where: (..._: unknown[]) => makeChainable(getValue),
    orderBy: (..._: unknown[]) => makeChainable(getValue),
    limit: (..._: unknown[]) => makeChainable(getValue),
    offset: (..._: unknown[]) => makeChainable(getValue),
    leftJoin: (..._: unknown[]) => makeChainable(getValue),
    innerJoin: (..._: unknown[]) => makeChainable(getValue),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(getValue()).then(res, rej),
  };
  return self;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (table: { __tableName?: string }) => {
        if (table.__tableName === "squads") return makeChainable(() => mockSquadRows.value);
        if (table.__tableName === "moments") return makeChainable(() => mockMomentRows.value);
        return makeChainable(() => mockFeedRows.value);
      },
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
        onConflictDoNothing: () => Promise.resolve(),
      }),
    }),
  },
  feedPostsTable: {
    id: "id",
    authorId: "author_id",
    audience: "audience",
    deletedAt: "deleted_at",
    __tableName: "feed_posts",
  },
  squadsTable: {
    id: "id",
    creatorId: "creator_id",
    coAdminIds: "co_admin_ids",
    memberIds: "member_ids",
    __tableName: "squads",
  },
  momentsTable: {
    id: "id",
    authorId: "author_id",
    audience: "audience",
    deletedAt: "deleted_at",
    expiresAt: "expires_at",
    status: "status",
    __tableName: "moments",
  },
  // Additional tables referenced by moments.ts
  friendshipsTable: { ownerId: "owner_id", friendId: "friend_id" },
  momentViewsTable: { momentId: "moment_id", viewerId: "viewer_id" },
  eventInvitesTable: { id: "id" },
}));

vi.mock("../storage", () => ({
  storage: {
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    clearPushToken: vi.fn(),
    getUser: vi.fn().mockResolvedValue(null),
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
    getFriendIds: vi.fn().mockResolvedValue([]),
    getBlockedUserIds: vi.fn().mockResolvedValue([]),
    getBlockedAndBlockerIds: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/feedEvents", () => ({
  emitFeedUpdate: vi.fn(),
  onFeedUpdate: vi.fn().mockReturnValue(() => {}),
}));
vi.mock("../routes/moderation", () => ({
  getBlockedAndBlockerIds: vi.fn().mockResolvedValue([]),
}));

import feedRouter from "../routes/feed";
import momentsRouter from "../routes/moments";
import { makeTestApp } from "./helpers/makeTestApp";

const AUTHOR_ID = "author-user";
const HOST_ID = "squad-host";
const CO_ADMIN_ID = "co-admin-user";
const UNRELATED_ID = "unrelated-user";
const SQUAD_ID = "squad-1";

function makeSquad(overrides: Record<string, unknown> = {}) {
  return {
    id: SQUAD_ID,
    creatorId: HOST_ID,
    coAdminIds: [CO_ADMIN_ID],
    memberIds: [HOST_ID, CO_ADMIN_ID, AUTHOR_ID, UNRELATED_ID],
    ...overrides,
  };
}

function makeSquadPost() {
  return {
    id: "post-1",
    authorId: AUTHOR_ID,
    audience: SQUAD_ID,
    deletedAt: null,
    text: "Hello squad",
    createdAt: new Date().toISOString(),
  };
}

function makeFriendsPost() {
  return { ...makeSquadPost(), audience: "friends" };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSquadRows.value = [makeSquad()];
  mockFeedRows.value = [];
  mockMomentRows.value = [];
});

// ── Feed posts ────────────────────────────────────────────────────────────────

describe("B3 — DELETE /api/feed/posts/:id — authorization matrix (Feed posts)", () => {
  it("author can delete their own post (200)", async () => {
    mockFeedRows.value = [makeSquadPost()];
    const res = await request(makeTestApp(feedRouter, { id: AUTHOR_ID }))
      .delete("/api/feed/posts/post-1");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("squad host can moderation-delete a squad-scoped post (200)", async () => {
    mockFeedRows.value = [makeSquadPost()];
    const res = await request(makeTestApp(feedRouter, { id: HOST_ID }))
      .delete("/api/feed/posts/post-1");
    expect(res.status).toBe(200);
  });

  it("squad co-admin can moderation-delete a squad-scoped post (200)", async () => {
    mockFeedRows.value = [makeSquadPost()];
    const res = await request(makeTestApp(feedRouter, { id: CO_ADMIN_ID }))
      .delete("/api/feed/posts/post-1");
    expect(res.status).toBe(200);
  });

  it("unrelated member cannot delete another user's post (403)", async () => {
    mockFeedRows.value = [makeSquadPost()];
    const res = await request(makeTestApp(feedRouter, { id: UNRELATED_ID }))
      .delete("/api/feed/posts/post-1");
    expect(res.status).toBe(403);
  });

  it("friends-scoped post: non-author cannot delete even if squad role exists (403)", async () => {
    mockFeedRows.value = [makeFriendsPost()];
    const res = await request(makeTestApp(feedRouter, { id: HOST_ID }))
      .delete("/api/feed/posts/post-1");
    expect(res.status).toBe(403);
  });

  it("returns 404 for a non-existent post", async () => {
    mockFeedRows.value = [];
    const res = await request(makeTestApp(feedRouter, { id: HOST_ID }))
      .delete("/api/feed/posts/post-1");
    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeTestApp(feedRouter))
      .delete("/api/feed/posts/post-1");
    expect(res.status).toBe(401);
  });
});

// ── Moments ───────────────────────────────────────────────────────────────────

describe("B3 — DELETE /api/moments/:id — authorization matrix (Moments)", () => {
  function makeSquadMoment() {
    return {
      id: "moment-1",
      authorId: AUTHOR_ID,
      audience: SQUAD_ID,
      deletedAt: null,
      status: "active",
      mediaUrl: "https://example.com/moment.mp4",
      createdAt: new Date().toISOString(),
    };
  }

  beforeEach(() => {
    mockMomentRows.value = [makeSquadMoment()];
  });

  it("author can delete their own moment (200)", async () => {
    const res = await request(makeTestApp(momentsRouter, { id: AUTHOR_ID }))
      .delete("/api/moments/moment-1");
    expect(res.status).toBe(200);
  });

  it("squad host can moderation-delete a squad moment (200)", async () => {
    const res = await request(makeTestApp(momentsRouter, { id: HOST_ID }))
      .delete("/api/moments/moment-1");
    expect(res.status).toBe(200);
  });

  it("squad co-admin can moderation-delete a squad moment (200)", async () => {
    const res = await request(makeTestApp(momentsRouter, { id: CO_ADMIN_ID }))
      .delete("/api/moments/moment-1");
    expect(res.status).toBe(200);
  });

  it("unrelated member cannot delete a squad moment (403)", async () => {
    const res = await request(makeTestApp(momentsRouter, { id: UNRELATED_ID }))
      .delete("/api/moments/moment-1");
    expect(res.status).toBe(403);
  });
});
