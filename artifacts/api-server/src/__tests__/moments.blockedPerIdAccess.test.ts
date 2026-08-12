/**
 * Audit #640 — blocking must cut off the per-id moment paths, not just the lists.
 *
 * Filtering blocked authors out of the squad/friends list queries is only half
 * the job. A squad-audience moment is authorized by MEMBERSHIP, and blocking
 * deliberately leaves shared squads intact (see the privacy invariants) — so a
 * blocked member who still holds a moment id could mark it viewed and react to
 * it. Reactions notify the author, which means the person who blocked them keeps
 * receiving pushes from them.
 *
 * The check lives in canViewMoment so views and reactions inherit it together.
 * The author is still allowed through for their own content.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const hoisted = vi.hoisted(() => ({
  moment: null as Record<string, unknown> | null,
  squadRow: null as unknown,
  friendIds: [] as string[],
  blockedIds: [] as string[],
  viewInserted: false,
  reactionInserted: false,
}));

vi.mock("../routes/moderation", () => ({
  getBlockedAndBlockerIds: vi.fn(async () => hoisted.blockedIds),
}));

vi.mock("@workspace/db", () => {
  const thenable = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), {
      where: () => thenable(rows),
      orderBy: () => Promise.resolve(rows),
      limit: () => Promise.resolve(rows),
    });
  return {
    db: {
      select: () => ({
        from: (t: { __name?: string }) => ({
          where: () => {
            if (t.__name === "moments") return thenable(hoisted.moment ? [hoisted.moment] : []);
            if (t.__name === "squads") return thenable(hoisted.squadRow ? [hoisted.squadRow] : []);
            if (t.__name === "friendships")
              return thenable(hoisted.friendIds.map((id) => ({ friendId: id })));
            return thenable([]);
          },
        }),
      }),
      insert: (t: { __name?: string }) => ({
        values: () => ({
          onConflictDoNothing: () => {
            if (t.__name === "moment_views") hoisted.viewInserted = true;
            if (t.__name === "moment_reactions") hoisted.reactionInserted = true;
            return Promise.resolve();
          },
        }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
    momentsTable: {
      __name: "moments",
      id: "id",
      authorId: "author_id",
      audience: "audience",
      status: "status",
      deletedAt: "deleted_at",
      expiresAt: "expires_at",
      createdAt: "created_at",
    },
    momentViewsTable: { __name: "moment_views", momentId: "moment_id", viewerId: "viewer_id", viewedAt: "viewed_at" },
    momentReactionsTable: { __name: "moment_reactions", momentId: "moment_id", userId: "user_id", emoji: "emoji" },
    friendshipsTable: { __name: "friendships", ownerId: "owner_id", friendId: "friend_id" },
    squadsTable: { __name: "squads", id: "id", memberIds: "member_ids" },
    usersTable: { __name: "users", id: "id" },
  };
});

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "viewer-id", firstName: "V" }),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    clearPushToken: vi.fn(),
    getUploadOwner: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("../lib/feedEvents", () => ({ emitFeedUpdate: vi.fn(), onFeedUpdate: () => () => {} }));
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: vi.fn() }));
vi.mock("../lib/notificationDebounce", () => ({
  shouldSendNotification: vi.fn().mockResolvedValue(true),
}));
vi.mock("../lib/logger");

import momentsRouter from "../routes/moments";
import { makeTestApp } from "./helpers/makeTestApp";

const AUTHOR = "author-id";
const VIEWER = "viewer-id";
const SQUAD = "squad-1";
const MOMENT_ID = 4242;

const app = (id: string) => makeTestApp(momentsRouter, { id });

const squadMoment = {
  id: MOMENT_ID,
  authorId: AUTHOR,
  audience: SQUAD,
  status: "visible",
  deletedAt: null,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.moment = { ...squadMoment };
  // Both remain members of the squad — blocking does not remove them.
  hoisted.squadRow = { id: SQUAD, memberIds: [AUTHOR, VIEWER] };
  hoisted.friendIds = [];
  hoisted.blockedIds = [];
  hoisted.viewInserted = false;
  hoisted.reactionInserted = false;
});

describe("blocked users cannot reach a moment by id", () => {
  it("403s marking a moment viewed when the author is blocked", async () => {
    hoisted.blockedIds = [AUTHOR];

    const res = await request(app(VIEWER)).post(`/api/moments/${MOMENT_ID}/views`);

    expect(res.status).toBe(403);
    expect(hoisted.viewInserted).toBe(false);
  });

  it("403s reacting to a moment when the author is blocked (no push to the blocker)", async () => {
    hoisted.blockedIds = [AUTHOR];

    const res = await request(app(VIEWER))
      .post(`/api/moments/${MOMENT_ID}/reactions`)
      .send({ emoji: "🔥" });

    expect(res.status).toBe(403);
    expect(hoisted.reactionInserted).toBe(false);
  });

  it("applies in BOTH directions — being blocked denies access just the same", async () => {
    // getBlockedAndBlockerIds returns blocker + blocked ids together, so this is
    // the same code path whichever side placed the block.
    hoisted.blockedIds = [AUTHOR];

    const res = await request(app(VIEWER)).post(`/api/moments/${MOMENT_ID}/views`);
    expect(res.status).toBe(403);
  });

  it("a squadmate with NO block can still view and react", async () => {
    const view = await request(app(VIEWER)).post(`/api/moments/${MOMENT_ID}/views`);
    expect(view.status).toBe(200);
    expect(hoisted.viewInserted).toBe(true);

    const react = await request(app(VIEWER))
      .post(`/api/moments/${MOMENT_ID}/reactions`)
      .send({ emoji: "🔥" });
    expect(react.status).toBe(201);
    expect(hoisted.reactionInserted).toBe(true);
  });

  it("hidden moments stay unreachable by id for non-authors", async () => {
    hoisted.moment = { ...squadMoment, status: "hidden" };

    const res = await request(app(VIEWER)).post(`/api/moments/${MOMENT_ID}/views`);
    expect(res.status).toBe(403);
  });

  it("the author still reaches their own hidden moment's viewer list", async () => {
    hoisted.moment = { ...squadMoment, status: "hidden" };

    const res = await request(app(AUTHOR)).get(`/api/moments/${MOMENT_ID}/viewers`);
    expect(res.status).toBe(200);
  });

  it("404s the viewer list for a deleted moment, even for the author", async () => {
    hoisted.moment = { ...squadMoment, deletedAt: new Date() };

    const res = await request(app(AUTHOR)).get(`/api/moments/${MOMENT_ID}/viewers`);
    expect(res.status).toBe(404);
  });
});
