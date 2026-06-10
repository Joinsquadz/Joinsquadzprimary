import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const uploadOwner = vi.hoisted(() => ({ value: null as string | null }));
const insertedMoment = vi.hoisted(() => ({
  value: { id: "moment-1", expiresAt: new Date("2030-01-01T00:00:00.000Z") } as {
    id: string;
    expiresAt: Date;
  },
}));

// Mock the storage facade: only the provenance lookup matters here; the
// fire-and-forget notification helpers are stubbed so the post-response async
// work can't throw.
vi.mock("../storage", () => ({
  storage: {
    getUploadOwner: () => Promise.resolve(uploadOwner.value),
    getUser: () => Promise.resolve(null),
    getPushTokensForUsers: () => Promise.resolve([]),
    filterUnmutedForSquad: (ids: string[]) => Promise.resolve(ids),
  },
}));

// Mock @workspace/db so the route never touches a real database. "friends"
// audience skips the squad lookup; the insert returns a canned moment row.
vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([insertedMoment.value]) }) }),
  },
  momentsTable: {},
  momentViewsTable: {},
  momentReactionsTable: {},
  friendshipsTable: {},
  squadsTable: {},
}));

vi.mock("../lib/feedEvents", () => ({
  emitFeedUpdate: () => {},
  onFeedUpdate: () => () => {},
}));
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: () => Promise.resolve([]) }));
vi.mock("../lib/logger");

import momentsRouter from "../routes/moments";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(momentsRouter, user);
const POST_PATH = "/api/moments";
const MEDIA_URL = "/objects/supabase/uploads/clip-abc.mp4";

describe("POST /api/moments media provenance", () => {
  beforeEach(() => {
    uploadOwner.value = null;
    insertedMoment.value = { id: "moment-1", expiresAt: new Date("2030-01-01T00:00:00.000Z") };
  });

  it("rejects a moment referencing media uploaded by another user", async () => {
    uploadOwner.value = "victim";
    const app = makeApp({ id: "attacker" });
    const res = await request(app)
      .post(POST_PATH)
      .send({ audience: "friends", mediaUrl: MEDIA_URL, mediaType: "video" });
    expect(res.status).toBe(403);
  });

  it("rejects a moment referencing an unknown (unrecorded) media path", async () => {
    uploadOwner.value = null;
    const app = makeApp({ id: "attacker" });
    const res = await request(app)
      .post(POST_PATH)
      .send({ audience: "friends", mediaUrl: MEDIA_URL, mediaType: "photo" });
    expect(res.status).toBe(403);
  });

  it("accepts a moment referencing media the author uploaded", async () => {
    uploadOwner.value = "author";
    const app = makeApp({ id: "author" });
    const res = await request(app)
      .post(POST_PATH)
      .send({ audience: "friends", mediaUrl: MEDIA_URL, mediaType: "video", durationMs: 5000 });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("moment-1");
  });
});
