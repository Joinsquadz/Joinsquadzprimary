/**
 * Audit #640 — GET /api/moments/squad/:squadId must apply the same suppression
 * rules as the friends/feed moment lists.
 *
 * The friends and feed lists both exclude `status = 'hidden'` (auto-hide fires
 * at 3 distinct reporters) and authors in a block relationship. The squad list
 * applied neither, so reported content stayed visible on the squad surface and
 * a blocked person's moments still appeared to the person who blocked them —
 * for a full 24h, on the one surface where they're guaranteed to meet.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const hoisted = vi.hoisted(() => ({
  squadRow: null as unknown,
  blockedIds: [] as string[],
  /** The WHERE clause the moments list query was built with. */
  lastMomentsWhere: null as Record<string, unknown> | null,
}));

vi.mock("../routes/moderation", () => ({
  getBlockedAndBlockerIds: vi.fn(async () => hoisted.blockedIds),
}));

vi.mock("@workspace/db", () => {
  const table = (name: string, extra: Record<string, string> = {}) => ({ __name: name, ...extra });
  return {
    db: {
      select: () => ({
        from: (t: { __name?: string }) => ({
          where: (cond: Record<string, unknown>) => {
            if (t.__name === "squads") return Promise.resolve(hoisted.squadRow ? [hoisted.squadRow] : []);
            if (t.__name === "moments") {
              hoisted.lastMomentsWhere = cond;
              return { orderBy: () => Promise.resolve([]) };
            }
            return Promise.resolve([]);
          },
        }),
      }),
    },
    momentsTable: table("moments", {
      id: "id",
      authorId: "author_id",
      audience: "audience",
      status: "status",
      deletedAt: "deleted_at",
      expiresAt: "expires_at",
      createdAt: "created_at",
    }),
    momentViewsTable: table("moment_views", { momentId: "moment_id", viewerId: "viewer_id" }),
    momentReactionsTable: table("moment_reactions", { momentId: "moment_id", userId: "user_id" }),
    friendshipsTable: table("friendships", { ownerId: "owner_id", friendId: "friend_id" }),
    squadsTable: table("squads", { id: "id", memberIds: "member_ids" }),
  };
});

// Capture the composed WHERE so we can assert the two predicates are present
// without needing a live Postgres.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    and: (...args: unknown[]) => Object.assign({}, ...args.filter((a) => a && typeof a === "object")),
    eq: () => ({}),
    gt: () => ({}),
    isNull: () => ({}),
    desc: () => ({}),
    inArray: () => ({}),
    ne: (col: unknown, value: unknown) => ({ __neStatus: value }),
    notInArray: (_col: unknown, ids: string[]) => ({ __notInAuthors: ids }),
  };
});

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue(null),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
    getUploadOwner: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock("../lib/feedEvents", () => ({ emitFeedUpdate: vi.fn(), onFeedUpdate: () => () => {} }));
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: vi.fn() }));
vi.mock("../lib/notificationDebounce", () => ({ shouldSendNotification: vi.fn() }));
vi.mock("../lib/logger");

import momentsRouter from "../routes/moments";
import { makeTestApp } from "./helpers/makeTestApp";

const ME = "me-id";
const SQUAD = "squad-1";
const BLOCKED = "blocked-author";

const app = () => makeTestApp(momentsRouter, { id: ME });

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.squadRow = { id: SQUAD, memberIds: [ME, BLOCKED] };
  hoisted.blockedIds = [];
  hoisted.lastMomentsWhere = null;
});

describe("GET /api/moments/squad/:squadId", () => {
  it("excludes hidden moments from the query", async () => {
    const res = await request(app()).get(`/api/moments/squad/${SQUAD}`);

    expect(res.status).toBe(200);
    expect(hoisted.lastMomentsWhere?.__neStatus).toBe("hidden");
  });

  it("excludes moments authored by someone in a block relationship", async () => {
    hoisted.blockedIds = [BLOCKED];

    const res = await request(app()).get(`/api/moments/squad/${SQUAD}`);

    expect(res.status).toBe(200);
    expect(hoisted.lastMomentsWhere?.__notInAuthors).toEqual([BLOCKED]);
  });

  it("adds no author filter when nothing is blocked", async () => {
    const res = await request(app()).get(`/api/moments/squad/${SQUAD}`);

    expect(res.status).toBe(200);
    expect(hoisted.lastMomentsWhere?.__notInAuthors).toBeUndefined();
  });

  it("still 403s a non-member before running any moments query", async () => {
    hoisted.squadRow = { id: SQUAD, memberIds: ["someone-else"] };

    const res = await request(app()).get(`/api/moments/squad/${SQUAD}`);

    expect(res.status).toBe(403);
    expect(hoisted.lastMomentsWhere).toBeNull();
  });
});
