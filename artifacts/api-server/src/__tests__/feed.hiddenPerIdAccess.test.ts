/**
 * Audit #640 — auto-hidden content must be unreachable by ID, not just absent
 * from lists.
 *
 * maybeAutoHide flips status to "hidden" once 3 distinct users report a post.
 * The list query filtered on that, but the per-id paths (react, comment, read
 * comments) loaded the row directly and only checked audience — so anyone
 * holding the id (from a screenshot, a push notification, or their own earlier
 * scroll) could keep reacting and commenting on reported content, and those
 * reactions kept generating activity + push for the author.
 *
 * The gate lives inside canViewPost so every per-id path inherits it. The
 * AUTHOR is deliberately still allowed through: they must be able to see and
 * delete their own hidden post.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const hoisted = vi.hoisted(() => ({
  post: null as Record<string, unknown> | null,
  friendIds: [] as string[],
  reactionInserted: false,
  commentInserted: false,
}));

vi.mock("@workspace/db", () => {
  const thenable = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), {
      where: () => thenable(rows),
      orderBy: () => Promise.resolve(rows),
      limit: () => Promise.resolve(rows),
      innerJoin: () => thenable(rows),
      leftJoin: () => thenable(rows),
    });
  return {
    db: {
      select: () => ({
        from: (t: { __name?: string }) => ({
          where: () => {
            if (t.__name === "feed_posts") {
              return thenable(hoisted.post ? [hoisted.post] : []);
            }
            if (t.__name === "friendships") {
              return thenable(hoisted.friendIds.map((id) => ({ friendId: id })));
            }
            return thenable([]);
          },
        }),
      }),
      insert: (t: { __name?: string }) => ({
        values: () => ({
          onConflictDoNothing: () => {
            if (t.__name === "feed_reactions") hoisted.reactionInserted = true;
            return Promise.resolve();
          },
          returning: () => {
            if (t.__name === "feed_comments") hoisted.commentInserted = true;
            return Promise.resolve([
              { id: "c1", postId: "p1", authorId: "viewer", text: "x", createdAt: new Date(0) },
            ]);
          },
        }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
    feedPostsTable: { __name: "feed_posts", id: "id", authorId: "author_id", audience: "audience", status: "status", deletedAt: "deleted_at", createdAt: "created_at", mediaUrl: "media_url" },
    feedReactionsTable: { __name: "feed_reactions", postId: "post_id", userId: "user_id", emoji: "emoji" },
    feedCommentsTable: { __name: "feed_comments", id: "id", postId: "post_id", userId: "user_id", body: "body", deletedAt: "deleted_at", createdAt: "created_at" },
    friendshipsTable: { __name: "friendships", ownerId: "owner_id", friendId: "friend_id" },
    squadsTable: { __name: "squads", id: "id", memberIds: "member_ids" },
    usersTable: { __name: "users", id: "id" },
  };
});

vi.mock("../routes/moderation", () => ({
  getBlockedAndBlockerIds: vi.fn().mockResolvedValue([]),
}));
vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "viewer", firstName: "V" }),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    clearPushToken: vi.fn(),
    getUploadOwner: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("../lib/feedEvents", () => ({ emitFeedUpdate: vi.fn(), onFeedUpdate: () => () => {} }));
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: vi.fn() }));
vi.mock("../lib/activity", () => ({ recordActivitySafe: vi.fn(), removeActivity: vi.fn() }));
vi.mock("../lib/notificationDebounce", () => ({ shouldSendNotification: vi.fn().mockResolvedValue(true) }));
vi.mock("../lib/logger");

import feedRouter from "../routes/feed";
import { makeTestApp } from "./helpers/makeTestApp";

const AUTHOR = "author-id";
const VIEWER = "viewer-id";
const POST_ID = "11111111-1111-4111-8111-111111111111";

const app = (id: string) => makeTestApp(feedRouter, { id });

const hiddenPost = {
  id: POST_ID,
  authorId: AUTHOR,
  audience: "friends",
  status: "hidden",
  deletedAt: null,
  mediaUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.post = { ...hiddenPost };
  hoisted.friendIds = [AUTHOR];
  hoisted.reactionInserted = false;
  hoisted.commentInserted = false;
});

describe("hidden feed posts are unreachable by id", () => {
  it("403s a reaction on a hidden post and writes nothing", async () => {
    const res = await request(app(VIEWER))
      .post(`/api/feed/posts/${POST_ID}/reactions`)
      .send({ emoji: "🔥" });

    expect(res.status).toBe(403);
    expect(hoisted.reactionInserted).toBe(false);
  });

  it("403s a comment on a hidden post and writes nothing", async () => {
    const res = await request(app(VIEWER))
      .post(`/api/feed/posts/${POST_ID}/comments`)
      .send({ text: "still here" });

    expect(res.status).toBe(403);
    expect(hoisted.commentInserted).toBe(false);
  });

  it("403s reading the comments of a hidden post", async () => {
    const res = await request(app(VIEWER)).get(`/api/feed/posts/${POST_ID}/comments`);
    expect(res.status).toBe(403);
  });

  it("still lets a viewer react once the post is NOT hidden", async () => {
    hoisted.post = { ...hiddenPost, status: "visible" };

    const res = await request(app(VIEWER))
      .post(`/api/feed/posts/${POST_ID}/reactions`)
      .send({ emoji: "🔥" });

    expect(res.status).toBe(201);
    expect(hoisted.reactionInserted).toBe(true);
  });

  it("still lets the AUTHOR reach their own hidden post", async () => {
    // The author needs access to see and delete it.
    const res = await request(app(AUTHOR)).get(`/api/feed/posts/${POST_ID}/comments`);
    expect(res.status).toBe(200);
  });
});

describe("blocked users are cut off from per-id feed access", () => {
  // Blocking hides the author's profile and filters the lists, but a squad-
  // audience post is authorized by MEMBERSHIP — and blocking deliberately
  // leaves shared squads intact. So without a block check here, someone who
  // was blocked could still react to and comment on the posts of the person
  // who blocked them, pushing a notification each time.
  const SQUAD_POST = {
    id: POST_ID,
    authorId: AUTHOR,
    audience: "squad-1",
    status: "visible",
    deletedAt: null,
    mediaUrl: null,
  };

  beforeEach(() => {
    hoisted.post = { ...SQUAD_POST };
    hoisted.friendIds = [];
  });

  it("403s a reaction from a blocked user on a shared-squad post", async () => {
    const { getBlockedAndBlockerIds } = await import("../routes/moderation");
    vi.mocked(getBlockedAndBlockerIds).mockResolvedValue([AUTHOR]);

    const res = await request(app(VIEWER))
      .post(`/api/feed/posts/${POST_ID}/reactions`)
      .send({ emoji: "🔥" });

    expect(res.status).toBe(403);
    expect(hoisted.reactionInserted).toBe(false);
  });

  it("403s a comment from a blocked user on a shared-squad post", async () => {
    const { getBlockedAndBlockerIds } = await import("../routes/moderation");
    vi.mocked(getBlockedAndBlockerIds).mockResolvedValue([AUTHOR]);

    const res = await request(app(VIEWER))
      .post(`/api/feed/posts/${POST_ID}/comments`)
      .send({ text: "hi" });

    expect(res.status).toBe(403);
    expect(hoisted.commentInserted).toBe(false);
  });

  it("blocks in the OTHER direction cut access too", async () => {
    // getBlockedAndBlockerIds returns both directions; the viewer being the one
    // who was blocked must be denied just the same.
    const { getBlockedAndBlockerIds } = await import("../routes/moderation");
    vi.mocked(getBlockedAndBlockerIds).mockResolvedValue([AUTHOR]);

    const res = await request(app(VIEWER)).get(`/api/feed/posts/${POST_ID}/comments`);
    expect(res.status).toBe(403);
  });
});
