import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Captures every emitFeedUpdate(userId) the route fires so we can assert who is
// nudged to refetch when a reaction is added/removed.
const emitted = vi.hoisted(() => ({ value: [] as string[] }));
const post = vi.hoisted(() => ({
  value: { id: "post-1", authorId: "author", audience: "squad-1", deletedAt: null } as {
    id: string;
    authorId: string;
    audience: string;
    deletedAt: Date | null;
  } | null,
}));
const squadRow = vi.hoisted(() => ({
  value: { id: "squad-1", memberIds: ["author", "reactor", "muted-bob"] as string[] },
}));

vi.mock("../lib/feedEvents", () => ({
  emitFeedUpdate: (id: string) => {
    emitted.value.push(id);
  },
  onFeedUpdate: () => () => {},
}));

// filterUnmutedForSquad would DROP "muted-bob". The reaction fan-out must NOT go
// through this filter (mute only silences push, not the live feed), so if the
// route regressed to notifyFeedAudience, "muted-bob" would be missing and these
// tests would fail.
vi.mock("../storage", () => ({
  storage: {
    filterUnmutedForSquad: (ids: string[]) =>
      Promise.resolve(ids.filter((id) => id !== "muted-bob")),
  },
}));

vi.mock("@workspace/db", () => {
  const feedPostsTable = { __t: "posts" };
  const squadsTable = { __t: "squads" };
  const friendshipsTable = { __t: "friends" };
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === feedPostsTable) return Promise.resolve(post.value ? [post.value] : []);
          if (table === squadsTable) return Promise.resolve([squadRow.value]);
          return Promise.resolve([]);
        },
      }),
    }),
    insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
    delete: () => ({ where: () => Promise.resolve() }),
  };
  return {
    db,
    feedPostsTable,
    squadsTable,
    friendshipsTable,
    feedReactionsTable: {},
    feedCommentsTable: {},
    usersTable: {},
  };
});

vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: () => Promise.resolve([]) }));
// canViewPost consults blocks on every per-id path (see
// feed.hiddenPerIdAccess.test.ts); stub it so this fan-out test doesn't need
// the blocks table in its minimal db mock.
vi.mock("../routes/moderation", () => ({
  getBlockedAndBlockerIds: vi.fn().mockResolvedValue([]),
}));
vi.mock("../lib/logger");

import feedRouter from "../routes/feed";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(feedRouter, user);
const flush = () => new Promise((r) => setTimeout(r, 20));

describe("feed reaction fan-out — live SSE nudges reach all viewers", () => {
  beforeEach(() => {
    emitted.value = [];
    post.value = { id: "post-1", authorId: "author", audience: "squad-1", deletedAt: null };
    squadRow.value = { id: "squad-1", memberIds: ["author", "reactor", "muted-bob"] };
  });

  it("adding a reaction nudges the author, the reactor, AND other (incl. muted) viewers", async () => {
    const app = makeApp({ id: "reactor" });
    const res = await request(app).post("/api/feed/posts/post-1/reactions").send({ emoji: "🔥" });
    expect(res.status).toBe(201);
    await flush();
    expect(emitted.value).toContain("author");
    expect(emitted.value).toContain("reactor");
    // The muted squad member can still SEE the post, so they must be nudged.
    expect(emitted.value).toContain("muted-bob");
  });

  it("removing a reaction nudges the author, the reactor, AND other (incl. muted) viewers", async () => {
    const app = makeApp({ id: "reactor" });
    const res = await request(app).delete(
      `/api/feed/posts/post-1/reactions/${encodeURIComponent("🔥")}`,
    );
    expect(res.status).toBe(200);
    await flush();
    expect(emitted.value).toContain("author");
    expect(emitted.value).toContain("reactor");
    expect(emitted.value).toContain("muted-bob");
  });
});
