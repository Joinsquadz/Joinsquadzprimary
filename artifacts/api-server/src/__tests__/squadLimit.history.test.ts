/**
 * Free-tier squad cap = 3, counted from the APPEND-ONLY membership ledger.
 *
 * The cap deliberately does NOT count live `squads.member_ids`. Counting live
 * membership let a free user cycle join → leave → join forever and never hit
 * the cap; a membership is a slot you SPEND, not a seat you rent. So:
 *   • `squad_member_history` rows are written once per (squad, user), never
 *     deleted, and rows for squads that no longer exist still count.
 *   • The history row commits in the SAME transaction as the membership write
 *     — a membership that lands while its ledger row is lost would hand the
 *     user a free extra slot forever.
 *   • Users already over the cap keep what they have; they just can't add more.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const capState = vi.hoisted(() => ({
  /** Slots already consumed (history rows). */
  used: 0,
  /** Rows the membership write returns — [] means "already a member". */
  updateRows: [{ id: "squad-1", memberIds: ["someone", "user-free"] }] as unknown[],
  /** Rows the squad insert returns. */
  insertRows: [{ id: "squad-new", memberIds: ["user-free"] }] as unknown[],
  /** The squad row lookups resolve to. */
  squadRow: {} as Record<string, unknown>,
  /** Everything inserted inside the transaction, in order. */
  txInserts: [] as Record<string, unknown>[],
  /** Whether the transaction committed (i.e. the callback returned). */
  committed: false,
}));

vi.mock("@workspace/db", () => {
  function chain(rows: unknown[]): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      from: () => obj,
      leftJoin: () => obj,
      where: () => obj,
      orderBy: () => obj,
      limit: () => Promise.resolve(rows),
      then: (r: (v: unknown) => unknown) => Promise.resolve(rows).then(r),
    };
    return obj;
  }

  return {
    db: {
      // Outer selects serve two callers: squad row lookups and the
      // history-ledger count (GET /squads/count). One row carrying both shapes
      // satisfies each without needing call-order bookkeeping.
      select: () => chain([{ ...capState.squadRow, count: capState.used }]),
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve(capState.insertRows),
          onConflictDoNothing: () => Promise.resolve(undefined),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({ returning: () => Promise.resolve(capState.updateRows) }),
        }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        capState.txInserts = [];
        capState.committed = false;
        const tx = {
          execute: vi.fn().mockResolvedValue({ rows: [] }),
          // The only select inside withSquadLimit is the history-ledger count.
          select: () => chain([{ count: capState.used }]),
          insert: () => ({
            values: (v: Record<string, unknown>) => {
              capState.txInserts.push(v);
              return {
                returning: () => Promise.resolve(capState.insertRows),
                onConflictDoNothing: () => Promise.resolve(undefined),
              };
            },
          }),
          update: () => ({
            set: () => ({
              where: () => ({ returning: () => Promise.resolve(capState.updateRows) }),
            }),
          }),
          delete: () => ({ where: () => Promise.resolve() }),
        };
        const out = await fn(tx);
        capState.committed = true;
        return out;
      }),
    },
    squadsTable: {
      id: "id", name: "name", emoji: "emoji", color: "color",
      memberIds: "member_ids", isPublic: "is_public", creatorId: "creator_id",
      inviteCode: "invite_code", inviteCodeExpiresAt: "invite_code_expires_at",
      createdAt: "created_at", version: "version", description: "description",
      membersCanInvite: "members_can_invite",
    },
    squadMemberHistoryTable: {
      squadId: "squad_id", userId: "user_id", firstJoinedAt: "first_joined_at",
    },
    usersTable: { id: "id", friendCode: "friend_code", firstName: "first_name", lastName: "last_name", profileImageUrl: "profile_image_url" },
    squadMutesTable: { userId: "user_id", squadId: "squad_id" },
    squadRemovalNoticesTable: { id: "id", userId: "user_id", seenAt: "seen_at" },
    squadInvitesTable: { id: "id", squadId: "squad_id", invitedUserId: "invited_user_id", status: "status" },
    activityTable: { id: "id", type: "type", subjectId: "subject_id", userId: "user_id", recipientId: "recipient_id" },
    eventsTable: { id: "id", squadId: "squad_id", version: "version", rsvps: "rsvps", polls: "polls", itinerary: "itinerary" },
    eventInvitesTable: { eventId: "event_id" },
    eventCreationsTable: { userId: "user_id", eventId: "event_id", source: "source", createdAt: "created_at" },
    conversationsTable: { id: "id", squadId: "squad_id" },
    photosTable: { squadId: "squad_id", sharedToSquad: "shared_to_squad" },
    availabilityPollsTable: { squadId: "squad_id" },
  };
});

const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  upsertUser: vi.fn(),
  getSubscription: vi.fn().mockResolvedValue(null),
  getActiveSubscriptionByCustomerId: vi.fn().mockResolvedValue(null),
  getSquad: vi.fn().mockResolvedValue(null),
  getPushTokensForUsers: vi.fn().mockResolvedValue([]),
  clearPushToken: vi.fn(),
  filterUnmutedForSquad: vi.fn(async (ids: string[]) => ids),
  getUsersByIds: vi.fn().mockResolvedValue([]),
  isSquadMemberPublic: vi.fn().mockResolvedValue(false),
}));

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue({ staleTokens: [] }),
}));
vi.mock("../lib/squadEvents", () => ({ emitSquadUpdate: vi.fn(), onSquadUpdate: vi.fn(() => () => {}) }));
vi.mock("../lib/activity", () => ({ recordActivitySafe: vi.fn(), removeActivity: vi.fn() }));
vi.mock("../lib/proStatus", () => ({
  resolveProStatus: vi.fn(async () => false),
  resolveProStatusForIds: vi.fn(async () => new Map()),
}));

import squadsRouter from "../routes/squads";
import { FREE_SQUAD_LIMIT } from "../lib/squadLimit";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const FREE_USER: TestUser = { id: "user-free", email: "free@test.com" };
const makeApp = (user?: TestUser) => makeTestApp(squadsRouter, user);

const historyInserts = () =>
  capState.txInserts.filter((v) => "squadId" in v && "userId" in v && !("name" in v));

beforeEach(() => {
  vi.clearAllMocks();
  capState.used = 0;
  capState.updateRows = [{ id: "squad-1", memberIds: ["someone", "user-free"] }];
  capState.insertRows = [{ id: "squad-new", memberIds: ["user-free"] }];
  capState.squadRow = {
    id: "squad-1",
    name: "Hikers",
    memberIds: ["someone"],
    isPublic: true,
    creatorId: "someone",
    version: 1,
  };
  storageMock.getUser.mockResolvedValue({
    id: FREE_USER.id,
    email: "free@test.com",
    stripeSubscriptionId: null,
    stripeCustomerId: null,
  });
});

describe("the free squad cap is 3", () => {
  it("allows a create at 2 slots used", async () => {
    capState.used = FREE_SQUAD_LIMIT - 1;

    const res = await request(makeApp(FREE_USER)).post("/api/squads").send({ name: "Hikers" });

    expect(res.status).toBe(201);
  });

  it("blocks a create at 3 slots used", async () => {
    capState.used = FREE_SQUAD_LIMIT;

    const res = await request(makeApp(FREE_USER)).post("/api/squads").send({ name: "Hikers" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SQUAD_LIMIT");
    expect(res.body.limit).toBe(3);
  });

  it("blocks a public join at the cap", async () => {
    capState.used = FREE_SQUAD_LIMIT;

    const res = await request(makeApp(FREE_USER)).post("/api/squads/squad-1/join").send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SQUAD_LIMIT");
  });

  it("lets an existing member re-join even when they are over the cap", async () => {
    // Legacy users who were over the cap when it changed keep what they have;
    // a re-join of a squad they're already in must stay an idempotent no-op.
    capState.used = FREE_SQUAD_LIMIT + 4;
    capState.squadRow = { ...capState.squadRow, memberIds: ["someone", FREE_USER.id] };
    capState.updateRows = [];

    const res = await request(makeApp(FREE_USER)).post("/api/squads/squad-1/join").send({});

    expect(res.status).toBe(200);
    expect(res.body.alreadyMember).toBe(true);
  });
});

describe("the membership ledger commits with the membership write", () => {
  it("writes the history row inside the create transaction", async () => {
    const res = await request(makeApp(FREE_USER)).post("/api/squads").send({ name: "Hikers" });

    expect(res.status).toBe(201);
    // Same tx as the squad insert: the cap counts these rows, so a squad that
    // exists without its ledger row is a permanently free extra slot.
    expect(capState.committed).toBe(true);
    expect(historyInserts()).toContainEqual(
      expect.objectContaining({ squadId: "squad-new", userId: FREE_USER.id }),
    );
  });

  it("writes the history row inside the join transaction", async () => {
    const res = await request(makeApp(FREE_USER)).post("/api/squads/squad-1/join").send({});

    expect(res.status).toBe(201);
    expect(historyInserts()).toContainEqual(
      expect.objectContaining({ squadId: "squad-1", userId: FREE_USER.id }),
    );
  });

  it("writes no history row when the join matched zero rows (already a member)", async () => {
    capState.squadRow = { ...capState.squadRow, memberIds: ["someone", FREE_USER.id] };
    capState.updateRows = [];

    await request(makeApp(FREE_USER)).post("/api/squads/squad-1/join").send({});

    // Their row already exists; re-inserting is harmless but pointless, and
    // the route must not treat a no-op join as a new slot.
    expect(historyInserts()).toHaveLength(0);
  });

  it("writes no history row when the cap rejects the write", async () => {
    capState.used = FREE_SQUAD_LIMIT;

    await request(makeApp(FREE_USER)).post("/api/squads/squad-1/join").send({});

    expect(historyInserts()).toHaveLength(0);
  });
});

describe("GET /api/squads/count", () => {
  it("reports ledger usage against the cap so the client can warn early", async () => {
    capState.used = 2;

    const res = await request(makeApp(FREE_USER)).get("/api/squads/count");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 2, limit: FREE_SQUAD_LIMIT });
  });

  it("can report a count ABOVE the limit for grandfathered users", async () => {
    // Users who were over the cap when it changed keep access — the endpoint
    // must report the truth rather than clamping to the limit.
    capState.used = 7;

    const res = await request(makeApp(FREE_USER)).get("/api/squads/count");

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(7);
    expect(res.body.limit).toBe(FREE_SQUAD_LIMIT);
  });

  it("requires authentication", async () => {
    const res = await request(makeApp()).get("/api/squads/count");
    expect(res.status).toBe(401);
  });
});
