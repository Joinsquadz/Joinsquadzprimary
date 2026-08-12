/**
 * Audit #640 — blocking must remove a person from DISCOVERY, not just from the
 * profile screen.
 *
 * Before this fix, only GET /users/:id/profile consulted the block table. A
 * blocked user still surfaced in name search, still resolved via their friend
 * code, and could still sit in the friends list — every one of those is an
 * add/interact affordance pointing at someone who has blocked you (or whom you
 * blocked). The profile route would then 403, so the UI dead-ended, and the
 * mere presence of the row confirmed the account exists.
 *
 * Deliberately NOT covered here (and must stay that way): bulk /api/users
 * hydration is not block-filtered, because blocking leaves shared squad group
 * chat intact and filtering there would blank out names for everyone in it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const hoisted = vi.hoisted(() => ({
  blockedIds: [] as string[],
  searchRows: [] as unknown[],
  friendCodeRows: [] as unknown[],
  friendshipRows: [] as unknown[],
  friendUserRows: [] as unknown[],
  /** Records the ids the friends route actually asked the users table for. */
  lastInArrayIds: null as string[] | null,
}));

vi.mock("../lib/blocks", () => ({
  getBlockedAndBlockerIds: vi.fn(async () => hoisted.blockedIds),
  isBlockedEitherWay: vi.fn(async () => false),
}));

// Distinguishes which table a select() targeted so one mock can serve the
// three routes under test.
vi.mock("@workspace/db", () => {
  // Only the search route terminates its query with .limit(); the friend-code
  // and friends lookups are awaited directly. That distinction is what lets one
  // mock serve all three routes.
  const makeResult = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), {
      limit: () => Promise.resolve(hoisted.searchRows),
    });
  return {
    db: {
      select: (_cols?: unknown) => ({
        from: (table: { __name?: string }) => ({
          where: (cond: unknown) => {
            if (table.__name === "friendships") return makeResult(hoisted.friendshipRows);
            if (table.__name === "users") {
              const c = cond as { __inArrayIds?: string[] } | undefined;
              if (c?.__inArrayIds) {
                hoisted.lastInArrayIds = c.__inArrayIds;
                return makeResult(hoisted.friendUserRows);
              }
              return makeResult(hoisted.friendCodeRows);
            }
            return makeResult([]);
          },
          limit: () => Promise.resolve(hoisted.searchRows),
        }),
      }),
    },
    usersTable: { __name: "users", id: "id", firstName: "first_name", lastName: "last_name", profileImageUrl: "profile_image_url", friendCode: "friend_code", moderationHidden: "moderation_hidden", bio: "bio", hometown: "hometown", stripeSubscriptionId: "s", stripeCustomerId: "c" },
    friendshipsTable: { __name: "friendships", ownerId: "owner_id", friendId: "friend_id" },
    squadsTable: { __name: "squads", id: "id", memberIds: "member_ids" },
    userBlocksTable: { __name: "user_blocks", id: "id", blockerId: "blocker_id", blockedId: "blocked_id" },
  };
});

// The search route builds its WHERE with drizzle helpers; stub them so the
// mock db can see which ids an inArray() targeted.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    and: (...args: unknown[]) => Object.assign({}, ...args.filter((a) => a && typeof a === "object")),
    eq: () => ({}),
    or: () => ({}),
    sql: Object.assign(() => ({}), { raw: () => ({}) }),
    inArray: (_col: unknown, ids: string[]) => ({ __inArrayIds: ids }),
    notInArray: (_col: unknown, ids: string[]) => ({ __notInArrayIds: ids }),
  };
});

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "target", isSquadzPlus: false }),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    clearPushToken: vi.fn(),
  },
}));
vi.mock("../lib/logger");
vi.mock("../lib/proStatus", () => ({ resolveProStatus: vi.fn().mockResolvedValue(false) }));
vi.mock("../lib/activity", () => ({ recordActivitySafe: vi.fn() }));
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: vi.fn() }));

import usersRouter from "../routes/users";
import { makeTestApp } from "./helpers/makeTestApp";
import { getBlockedAndBlockerIds } from "../lib/blocks";

const ME = "me-id";
const BLOCKED = "blocked-id";
const NEUTRAL = "neutral-id";

const app = () => makeTestApp(usersRouter, { id: ME });

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.blockedIds = [];
  hoisted.searchRows = [];
  hoisted.friendCodeRows = [];
  hoisted.friendshipRows = [];
  hoisted.friendUserRows = [];
  hoisted.lastInArrayIds = null;
});

describe("GET /api/users/search — block-aware discovery", () => {
  it("excludes blocked users from the SQL query", async () => {
    hoisted.blockedIds = [BLOCKED];
    hoisted.searchRows = [{ id: NEUTRAL, firstName: "Neutral", lastName: "Person" }];

    const res = await request(app()).get("/api/users/search?q=per");

    expect(res.status).toBe(200);
    // The exclusion must happen in the query, not by post-filtering, so a
    // blocked match can never consume one of the 20 result slots.
    expect(getBlockedAndBlockerIds).toHaveBeenCalledWith(ME);
    expect(res.body.map((u: { id: string }) => u.id)).not.toContain(BLOCKED);
  });

  it("still returns results normally when nothing is blocked", async () => {
    hoisted.searchRows = [{ id: NEUTRAL, firstName: "Neutral", lastName: "Person" }];
    const res = await request(app()).get("/api/users/search?q=per");
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe(NEUTRAL);
  });
});

describe("GET /api/users/by-friend-code/:code — block-aware discovery", () => {
  it("404s for a blocked user's friend code, with neutral copy", async () => {
    hoisted.blockedIds = [BLOCKED];
    hoisted.friendCodeRows = [{ id: BLOCKED, firstName: "Blocked", lastName: "Person", friendCode: "ABC123" }];

    const res = await request(app()).get("/api/users/by-friend-code/ABC123");

    expect(res.status).toBe(404);
    // Never disclose that a block (rather than a bad code) is the reason.
    expect(JSON.stringify(res.body).toLowerCase()).not.toContain("block");
  });

  it("resolves a normal user's friend code", async () => {
    hoisted.friendCodeRows = [{ id: NEUTRAL, firstName: "Neutral", lastName: "Person", friendCode: "XYZ789" }];
    const res = await request(app()).get("/api/users/by-friend-code/XYZ789");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(NEUTRAL);
  });

  it("still resolves your OWN friend code even in a weird block state", async () => {
    hoisted.blockedIds = [ME];
    hoisted.friendCodeRows = [{ id: ME, firstName: "Me", lastName: "Self", friendCode: "MINE01" }];
    const res = await request(app()).get("/api/users/by-friend-code/MINE01");
    expect(res.status).toBe(200);
  });
});

describe("GET /api/users/friends — block-aware listing", () => {
  it("drops a blocked user from the friends list", async () => {
    hoisted.blockedIds = [BLOCKED];
    hoisted.friendshipRows = [{ friendId: BLOCKED }, { friendId: NEUTRAL }];
    hoisted.friendUserRows = [{ id: NEUTRAL, firstName: "Neutral", lastName: "Person" }];

    const res = await request(app()).get("/api/users/friends");

    expect(res.status).toBe(200);
    // The blocked id must never even be looked up.
    expect(hoisted.lastInArrayIds).toEqual([NEUTRAL]);
    expect(res.body.map((u: { id: string }) => u.id)).not.toContain(BLOCKED);
  });

  it("returns an empty list (no user query) when every friend is blocked", async () => {
    hoisted.blockedIds = [BLOCKED];
    hoisted.friendshipRows = [{ friendId: BLOCKED }];

    const res = await request(app()).get("/api/users/friends");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(hoisted.lastInArrayIds).toBeNull();
  });
});
