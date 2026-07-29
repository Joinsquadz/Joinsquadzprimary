/**
 * Phase 3 — Free-tier event cap regression.
 *
 * Root cause confirmed: server enforces FREE_EVENT_LIMIT = 5 (correct).
 * The UI bug was profile.tsx hardcoding useState(3) instead of using the
 * server-returned limit from GET /api/events/count.
 *
 * Tests confirm:
 *  1. GET /api/events/count always returns { limit: 5 } — the server is the
 *     source of truth and the correct value is 5, not 3.
 *  2. A free user is blocked on their 6th event (POST /api/events → 403),
 *     and the error message references "5" (not "3").
 *  3. A Pro user is never blocked by the cap.
 *  4. A user at count 3 is NOT blocked (3 is not the real cap).
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

const FREE_EVENT_LIMIT = 5;
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
  it("returns limit: 5 (FREE_EVENT_LIMIT) regardless of current count", async () => {
    storageMock.countUserEventCreationsInWindow.mockResolvedValue(2);

    const res = await request(makeApp(FREE_USER)).get("/api/events/count");

    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(FREE_EVENT_LIMIT);
    expect(res.body.count).toBe(2);
  });

  it("returns { count: 0, limit: 5 } for a brand-new user", async () => {
    storageMock.countUserEventCreationsInWindow.mockResolvedValue(0);

    const res = await request(makeApp(FREE_USER)).get("/api/events/count");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, limit: FREE_EVENT_LIMIT });
  });

  it("returns { count: 5, limit: 5 } when the user is at the cap", async () => {
    storageMock.countUserEventCreationsInWindow.mockResolvedValue(FREE_EVENT_LIMIT);

    const res = await request(makeApp(FREE_USER)).get("/api/events/count");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: FREE_EVENT_LIMIT, limit: FREE_EVENT_LIMIT });
  });

  it("limit is always 5, never 3 — regression for the UI display bug", async () => {
    for (let count = 0; count <= 6; count++) {
      storageMock.countUserEventCreationsInWindow.mockResolvedValue(count);
      const res = await request(makeApp(FREE_USER)).get("/api/events/count");
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(5);
      expect(res.body.limit).not.toBe(3);
    }
  });

  it("requires authentication — 401 for unauthenticated requests", async () => {
    const res = await request(makeApp()).get("/api/events/count");
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/events — enforcement at exactly 5 (free users)
// ---------------------------------------------------------------------------
describe("POST /api/events — free-tier cap enforcement at 5", () => {
  const baseEvent = {
    title: "Test Event",
    eventAt: new Date(Date.now() + 86400000).toISOString(),
    type: "event",
  };

  it("allows the 4th event (count 3 in window — old UI limit must not block)", async () => {
    // Key regression: the old UI showed limit=3, but the server must allow
    // events 4 and 5. Verifies 3 is NOT the enforcement boundary.
    dbState.selectRows = [{ count: 3 }]; // 3 existing in window
    dbState.insertRows = [{ id: "evt-4", hostId: FREE_USER.id, rsvps: {}, version: 0 }];

    const res = await request(makeApp(FREE_USER))
      .post("/api/events")
      .send(baseEvent);

    expect(res.status).not.toBe(403);
  });

  it("allows the 5th event (count 4 in window)", async () => {
    dbState.selectRows = [{ count: 4 }]; // 4 existing → 5th is OK
    dbState.insertRows = [{ id: "evt-5", hostId: FREE_USER.id, rsvps: {}, version: 0 }];

    const res = await request(makeApp(FREE_USER))
      .post("/api/events")
      .send(baseEvent);

    expect(res.status).not.toBe(403);
  });

  it("blocks the 6th event with 403 — cap is 5, not 3", async () => {
    // When 5 events already exist in the 12-month window, the next create is blocked.
    dbState.selectRows = [{ count: 5 }]; // at the limit

    const res = await request(makeApp(FREE_USER))
      .post("/api/events")
      .send(baseEvent);

    expect(res.status).toBe(403);
    // The error must reference "5" (the real limit) — never "3"
    expect(res.body.error).toMatch(/5/);
    expect(res.body.error).not.toMatch(/\b3\b/);
    expect(res.body.requiresPro).toBe(true);
    expect(res.body.limit).toBe(FREE_EVENT_LIMIT);
  });

  it("does NOT block a Pro user (stripeSubscriptionId + active sub) at count 5", async () => {
    storageMock.getUser.mockResolvedValue({
      id: PRO_USER.id,
      email: "pro@test.com",
      stripeSubscriptionId: "sub_pro",
      stripeCustomerId: null,
    });
    storageMock.getSubscription.mockResolvedValue({ status: "active" });
    // Even with 5 in the window, Pro users bypass the cap
    dbState.selectRows = [{ count: 5 }];
    dbState.insertRows = [{ id: "evt-6", hostId: PRO_USER.id, rsvps: {}, version: 0 }];

    const res = await request(makeApp(PRO_USER))
      .post("/api/events")
      .send(baseEvent);

    expect(res.status).not.toBe(403);
  });
});
