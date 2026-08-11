/**
 * Free-tier PLAN cap regression.
 *
 * The cap is 3 PLANS — events and trips combined — in a rolling 12-month
 * window, counted off the append-only event_creations ledger. The client must
 * never hardcode the number: it reads the limit from GET /api/events/count.
 *
 * Tests confirm:
 *  1. GET /api/events/count returns the server's limit — the source of truth.
 *  2. A free user is blocked on their 4th plan (POST /api/events → 403).
 *  3. A Pro user is never blocked by the cap.
 *  4. Events and trips draw from the SAME pool (a trip is not a free extra).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// DB state — mutable per test
// ---------------------------------------------------------------------------
const dbState = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  insertRows: [] as unknown[],
}));

// ---------------------------------------------------------------------------
// DB mock — transaction executor exposes execute + select + insert
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  // W-02: select chain must now support leftJoin (orphaned-cancel exclusion query)
  // and limit (oldest-row query for nextSlotAvailableAt). The chain is thenable
  // at any point so both the count query (.where().then) and the oldest query
  // (.where().orderBy().limit()) resolve to dbState.selectRows.
  const makeTx = () => {
    function chain(): Record<string, unknown> {
      const obj: Record<string, unknown> = {
        from: () => obj,
        leftJoin: () => obj,
        where: () => obj,
        orderBy: () => obj,
        limit: () => Promise.resolve(dbState.selectRows),
        then: (r: (v: unknown) => unknown) => Promise.resolve(dbState.selectRows).then(r),
      };
      return obj;
    }
    return {
      execute: vi.fn().mockResolvedValue(undefined),
      select: () => chain(),
      insert: () => ({
        values: () => ({ returning: () => Promise.resolve(dbState.insertRows) }),
      }),
    };
  };

  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(dbState.selectRows),
          orderBy: () => Promise.resolve(dbState.selectRows),
        }),
      }),
      insert: () => ({
        values: () => ({ returning: () => Promise.resolve(dbState.insertRows) }),
      }),
      update: () => ({
        set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      transaction: vi.fn(async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) =>
        fn(makeTx()),
      ),
    },
    eventsTable: {
      id: "id", hostId: "host_id", rsvps: "rsvps", createdAt: "created_at",
      inviteCode: "invite_code", version: "version", type: "type",
      squadId: "squad_id", eventAt: "event_at", endAt: "end_at",
      invitedUserIds: "invited_user_ids",
    },
    eventCreationsTable: { userId: "user_id", eventId: "event_id", createdAt: "created_at" },
    usersTable: {},
    squadMembersTable: {},
    squadsTable: { id: "id" },
    friendshipsTable: {},
  };
});

// ---------------------------------------------------------------------------
// Storage mock
// ---------------------------------------------------------------------------
const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  upsertUser: vi.fn(),
  getSubscription: vi.fn(),
  getActiveSubscriptionByCustomerId: vi.fn(),
  countUserEventsThisYear: vi.fn(),
  countUserEventCreationsInWindow: vi.fn(),
  // #519: also queried by GET /events/count for UpgradeModal slot-hint date.
  getOldestEventCreationAt: vi.fn(),
  getSquad: vi.fn(),
  filterUnmutedForSquad: vi.fn(),
  getPushTokensForUsers: vi.fn(),
  clearPushToken: vi.fn(),
  getFriendIds: vi.fn(),
  getSquadIdsForUser: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue({ staleTokens: [] }),
}));

import eventsRouter from "../routes/events";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const FREE_EVENT_LIMIT = 3;
const FREE_USER: TestUser = { id: "user-free", email: "free@test.com" };
const PRO_USER: TestUser = { id: "user-pro", email: "pro@test.com" };

function makeApp(user?: TestUser) {
  return makeTestApp(eventsRouter, user);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.selectRows = [];
  dbState.insertRows = [{ id: "evt-new", hostId: FREE_USER.id, rsvps: {}, version: 0 }];

  // Default: free user with no Stripe subscription, 0 events created
  storageMock.getUser.mockResolvedValue({ id: FREE_USER.id, email: "free@test.com", stripeSubscriptionId: null, stripeCustomerId: null });
  storageMock.upsertUser.mockResolvedValue({ id: FREE_USER.id });
  storageMock.getSubscription.mockResolvedValue(null);
  storageMock.getActiveSubscriptionByCustomerId.mockResolvedValue(null);
  storageMock.countUserEventsThisYear.mockResolvedValue(0);
  storageMock.countUserEventCreationsInWindow.mockResolvedValue(0);
  storageMock.getOldestEventCreationAt.mockResolvedValue(null);
  storageMock.getSquad.mockResolvedValue(null);
  storageMock.filterUnmutedForSquad.mockImplementation(async (ids: string[]) => ids);
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.clearPushToken.mockResolvedValue(undefined);
  storageMock.getFriendIds.mockResolvedValue([]);
  storageMock.getSquadIdsForUser.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// GET /api/events/count — source of truth for UI display
// ---------------------------------------------------------------------------
describe("GET /api/events/count — returns server-enforced limit", () => {
  it("returns limit: 3 (FREE_EVENT_LIMIT) regardless of current count", async () => {
    storageMock.countUserEventCreationsInWindow.mockResolvedValue(2);

    const res = await request(makeApp(FREE_USER)).get("/api/events/count");

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(FREE_EVENT_LIMIT);
    expect(res.body.count).toBe(2);
  });

  it("returns { count: 0, limit: 3, nextSlotAvailableAt: null } for a brand-new user", async () => {
    storageMock.countUserEventCreationsInWindow.mockResolvedValue(0);
    storageMock.getOldestEventCreationAt.mockResolvedValue(null);

    const res = await request(makeApp(FREE_USER)).get("/api/events/count");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, limit: FREE_EVENT_LIMIT, nextSlotAvailableAt: null });
  });

  it("returns { count: 3, limit: 3 } when the user is at the cap", async () => {
    storageMock.countUserEventCreationsInWindow.mockResolvedValue(FREE_EVENT_LIMIT);

    const res = await request(makeApp(FREE_USER)).get("/api/events/count");

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(FREE_EVENT_LIMIT);
    expect(res.body.limit).toBe(FREE_EVENT_LIMIT);
  });

  // #519: nextSlotAvailableAt thread-through tests.
  it("includes nextSlotAvailableAt when the user has plan slots used", async () => {
    storageMock.countUserEventCreationsInWindow.mockResolvedValue(2);
    storageMock.getOldestEventCreationAt.mockResolvedValue("2027-01-15T10:00:00.000Z");

    const res = await request(makeApp(FREE_USER)).get("/api/events/count");

    expect(res.status).toBe(200);
    expect(res.body.nextSlotAvailableAt).toBe("2027-01-15T10:00:00.000Z");
    expect(res.body.count).toBe(2);
  });

  it("returns nextSlotAvailableAt: null when the user has no plan slots used", async () => {
    storageMock.countUserEventCreationsInWindow.mockResolvedValue(0);
    storageMock.getOldestEventCreationAt.mockResolvedValue(null);

    const res = await request(makeApp(FREE_USER)).get("/api/events/count");

    expect(res.status).toBe(200);
    expect(res.body.nextSlotAvailableAt).toBeNull();
  });

  // #633: the free tier is now 3 COMBINED plans (events + trips). The reported
  // limit must be the enforced one at every count — the old bug was a UI number
  // that disagreed with the server.
  it("limit is always 3, never the retired 5", async () => {
    for (let count = 0; count <= 6; count++) {
      storageMock.countUserEventCreationsInWindow.mockResolvedValue(count);
      const res = await request(makeApp(FREE_USER)).get("/api/events/count");
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(3);
      expect(res.body.limit).not.toBe(5);
    }
  });

  it("requires authentication — 401 for unauthenticated requests", async () => {
    const res = await request(makeApp()).get("/api/events/count");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/events — enforcement at exactly 3 combined plans (free users)
// ---------------------------------------------------------------------------
describe("POST /api/events — free-tier plan cap enforcement at 3", () => {
  const baseEvent = {
    title: "Test Event",
    eventAt: new Date(Date.now() + 86400000).toISOString(),
    type: "event",
  };

  it("allows the 2nd plan (1 slot used in window)", async () => {
    dbState.selectRows = [{ count: 1 }];
    dbState.insertRows = [{ id: "evt-2", hostId: FREE_USER.id, rsvps: {}, version: 0 }];

    const res = await request(makeApp(FREE_USER))
      .post("/api/events")
      .send(baseEvent);

    expect(res.status).not.toBe(403);
  });

  it("allows the 3rd plan (2 slots used in window)", async () => {
    dbState.selectRows = [{ count: 2 }];
    dbState.insertRows = [{ id: "evt-3", hostId: FREE_USER.id, rsvps: {}, version: 0 }];

    const res = await request(makeApp(FREE_USER))
      .post("/api/events")
      .send(baseEvent);

    expect(res.status).not.toBe(403);
  });

  it("blocks the 4th plan with 403 — cap is 3, not the retired 5", async () => {
    dbState.selectRows = [{ count: 3 }]; // at the limit

    const res = await request(makeApp(FREE_USER))
      .post("/api/events")
      .send(baseEvent);

    expect(res.status).toBe(403);
    // The error must reference "3" (the real limit) — never the retired "5".
    expect(res.body.error).toMatch(/3/);
    expect(res.body.error).not.toMatch(/\b5\b/);
    expect(res.body.requiresPro).toBe(true);
    expect(res.body.limit).toBe(FREE_EVENT_LIMIT);
  });

  // #633: trips share the SAME allowance as events — a trip is a plan, so it
  // must be blocked by an already-full combined budget, not get its own.
  it("blocks a TRIP too — events and trips share one combined allowance", async () => {
    dbState.selectRows = [{ count: 3 }];

    const res = await request(makeApp(FREE_USER))
      .post("/api/events")
      .send({ ...baseEvent, type: "trip" });

    expect(res.status).toBe(403);
    expect(res.body.requiresPro).toBe(true);
    expect(res.body.limit).toBe(FREE_EVENT_LIMIT);
  });

  it("does NOT block a Pro user (stripeSubscriptionId + active sub) at the cap", async () => {
    storageMock.getUser.mockResolvedValue({
      id: PRO_USER.id,
      email: "pro@test.com",
      stripeSubscriptionId: "sub_pro",
      stripeCustomerId: null,
    });
    storageMock.getSubscription.mockResolvedValue({ status: "active" });
    // Even at the free cap, Pro users bypass it entirely.
    dbState.selectRows = [{ count: 3 }];
    dbState.insertRows = [{ id: "evt-4", hostId: PRO_USER.id, rsvps: {}, version: 0 }];

    const res = await request(makeApp(PRO_USER))
      .post("/api/events")
      .send(baseEvent);

    expect(res.status).not.toBe(403);
  });
});
