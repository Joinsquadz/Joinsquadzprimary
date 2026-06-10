import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const uploadOwner = vi.hoisted(() => ({ value: null as string | null }));
const insertedPost = vi.hoisted(() => ({ value: { id: "post-1" } as { id: string } }));

// Mock the storage facade: only the provenance lookup matters for these tests;
// the fire-and-forget notification helpers are stubbed so the post-response
// async work can't throw.
vi.mock("../storage", () => ({
  storage: {
    getUploadOwner: () => Promise.resolve(uploadOwner.value),
    getUser: () => Promise.resolve(null),
    getPushTokensForUsers: () => Promise.resolve([]),
  },
}));

// Mock @workspace/db so the route never touches a real database. "friends"
// audience skips the squad lookup; the insert returns a canned post row.
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([insertedPost.value]) }) }),
  },
  feedPostsTable: {},
  feedReactionsTable: {},
  feedCommentsTable: {},
  friendshipsTable: {},
  squadsTable: {},
  usersTable: {},
}));

vi.mock("../lib/feedEvents", () => ({
  emitFeedUpdate: () => {},
  onFeedUpdate: () => () => {},
}));
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: () => Promise.resolve([]) }));
vi.mock("../lib/logger");

import feedRouter from "../routes/feed";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(feedRouter, user);
const POST_PATH = "/api/feed/posts";
const MEDIA_URL = "/objects/supabase/uploads/clip-abc.mp4";

describe("POST /api/feed/posts media provenance", () => {
  beforeEach(() => {
    uploadOwner.value = null;
    insertedPost.value = { id: "post-1" };
  });

  it("rejects a post referencing media uploaded by another user", async () => {
    uploadOwner.value = "victim";
    const app = makeApp({ id: "attacker" });
    const res = await request(app)
      .post(POST_PATH)
      .send({ audience: "friends", mediaUrl: MEDIA_URL, mediaType: "video" });
    expect(res.status).toBe(403);
  });

  it("rejects a post referencing an unknown (unrecorded) media path", async () => {
    uploadOwner.value = null;
    const app = makeApp({ id: "attacker" });
    const res = await request(app)
      .post(POST_PATH)
      .send({ audience: "friends", mediaUrl: MEDIA_URL, mediaType: "photo" });
    expect(res.status).toBe(403);
  });

  it("accepts a post referencing media the author uploaded", async () => {
    uploadOwner.value = "author";
    const app = makeApp({ id: "author" });
    const res = await request(app)
      .post(POST_PATH)
      .send({ audience: "friends", mediaUrl: MEDIA_URL, mediaType: "video", durationMs: 5000 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "post-1" });
  });

  it("allows a text-only post with no media (no provenance check)", async () => {
    uploadOwner.value = null;
    const app = makeApp({ id: "author" });
    const res = await request(app).post(POST_PATH).send({ audience: "friends", text: "hi" });
    expect(res.status).toBe(201);
  });
});
