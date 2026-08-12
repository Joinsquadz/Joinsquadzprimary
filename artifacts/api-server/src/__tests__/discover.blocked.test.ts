/**
 * Audit #640 — the discover feed must not recommend things on the strength of
 * someone you've blocked (or who blocked you).
 *
 * Discovery works entirely off the friend set: a public squad surfaces because
 * a friend is a member, a public event because a friend RSVP'd "going". Blocks
 * were never consulted, so after A blocks B, B's squads and events kept being
 * recommended to A — attributed to B's participation. Filtering the friend set
 * removes them from both queries at once.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const hoisted = vi.hoisted(() => ({
  friendRows: [] as { friendId: string }[],
  blockedIds: [] as string[],
  squadRows: [] as unknown[],
  eventRows: [] as unknown[],
  /** friendIds the squad query was actually built with, or null if never run. */
  squadQueryFriendIds: null as string[] | null,
}));

vi.mock("../lib/blocks", () => ({
  getBlockedAndBlockerIds: vi.fn(async () => hoisted.blockedIds),
  isBlockedEitherWay: vi.fn(async () => false),
}));

vi.mock("@workspace/db", () => {
  const terminal = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), {
      orderBy: () => ({ limit: () => Promise.resolve(rows) }),
      limit: () => Promise.resolve(rows),
    });
  return {
    db: {
      select: () => ({
        from: (t: { __name?: string }) => ({
          where: (cond: { __friendIds?: string[] }) => {
            if (t.__name === "friendships") return terminal(hoisted.friendRows);
            if (t.__name === "squads") {
              hoisted.squadQueryFriendIds = cond?.__friendIds ?? [];
              return terminal(hoisted.squadRows);
            }
            if (t.__name === "events") return terminal(hoisted.eventRows);
            return terminal([]);
          },
        }),
      }),
    },
    eventsTable: { __name: "events", isPublic: "is_public", hostId: "host_id", rsvps: "rsvps", cancelled: "cancelled", createdAt: "created_at" },
    squadsTable: { __name: "squads", isPublic: "is_public", memberIds: "member_ids", createdAt: "created_at", creatorId: "creator_id" },
    usersTable: { __name: "users", id: "id", firstName: "first_name", lastName: "last_name" },
    friendshipsTable: { __name: "friendships", ownerId: "owner_id", friendId: "friend_id" },
  };
});

// Capture which friend ids reached the squad overlap predicate.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const sqlFn = (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const arr = vals.find((v) => Array.isArray(v)) as string[] | undefined;
    return arr ? { __friendIds: arr } : {};
  };
  return {
    ...actual,
    and: (...args: unknown[]) => Object.assign({}, ...args.filter((a) => a && typeof a === "object")),
    eq: () => ({}),
    ne: () => ({}),
    inArray: () => ({}),
    sql: Object.assign(sqlFn, { raw: () => ({}) }),
  };
});

vi.mock("../lib/logger");

import discoverRouter from "../routes/discover";
import { makeTestApp } from "./helpers/makeTestApp";

const ME = "me-id";
const FRIEND = "friend-id";
const BLOCKED = "blocked-friend-id";

const app = () => makeTestApp(discoverRouter, { id: ME });

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.friendRows = [];
  hoisted.blockedIds = [];
  hoisted.squadRows = [];
  hoisted.eventRows = [];
  hoisted.squadQueryFriendIds = null;
});

describe("GET /api/discover — block filtering", () => {
  it("drops a blocked user from the friend set driving discovery", async () => {
    hoisted.friendRows = [{ friendId: FRIEND }, { friendId: BLOCKED }];
    hoisted.blockedIds = [BLOCKED];

    const res = await request(app()).get("/api/discover");

    expect(res.status).toBe(200);
    expect(hoisted.squadQueryFriendIds).toEqual([FRIEND]);
  });

  it("returns an empty feed (and runs no squad query) when every friend is blocked", async () => {
    hoisted.friendRows = [{ friendId: BLOCKED }];
    hoisted.blockedIds = [BLOCKED];

    const res = await request(app()).get("/api/discover");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: [], squads: [] });
    expect(hoisted.squadQueryFriendIds).toBeNull();
  });

  it("excludes events whose only 'going' friend is blocked", async () => {
    hoisted.friendRows = [{ friendId: FRIEND }, { friendId: BLOCKED }];
    hoisted.blockedIds = [BLOCKED];
    hoisted.eventRows = [
      { id: "e-blocked", rsvps: { [BLOCKED]: "going" } },
      { id: "e-ok", rsvps: { [FRIEND]: "going" } },
    ];

    const res = await request(app()).get("/api/discover");

    expect(res.status).toBe(200);
    expect(res.body.events.map((e: { id: string }) => e.id)).toEqual(["e-ok"]);
  });

  it("leaves discovery untouched when nothing is blocked", async () => {
    hoisted.friendRows = [{ friendId: FRIEND }];
    hoisted.eventRows = [{ id: "e-ok", rsvps: { [FRIEND]: "going" } }];

    const res = await request(app()).get("/api/discover");

    expect(res.status).toBe(200);
    expect(hoisted.squadQueryFriendIds).toEqual([FRIEND]);
    expect(res.body.events).toHaveLength(1);
  });
});
