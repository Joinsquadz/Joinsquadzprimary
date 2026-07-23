// D4 — cancelled events must be excluded from the settle-up view.
//
// The server returns the `cancelled` field on every event; the client filters
// these out in the SettleUp component. This test verifies that:
//   (a) GET /events returns the `cancelled` boolean on each event row so the
//       client can filter, and
//   (b) PATCH /events/:id with `cancelled:true` persists the flag correctly
//       (so subsequent GETs see it and the client can exclude the event).
//
// D4 also covers departed-member rendering: costs must include enough snapshot
// info (paidById, shares[].userId) for the client to render departed members
// gracefully even if they no longer appear in the RSVP map.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));

// Chainable thenable so .from().where().orderBy() all resolve correctly.
function makeChainable(getValue: () => unknown[]): Record<string, unknown> {
  const self: Record<string, unknown> = {
    where: (..._: unknown[]) => makeChainable(getValue),
    orderBy: (..._: unknown[]) => makeChainable(getValue),
    limit: (..._: unknown[]) => makeChainable(getValue),
    offset: (..._: unknown[]) => makeChainable(getValue),
    leftJoin: (..._: unknown[]) => makeChainable(getValue),
    innerJoin: (..._: unknown[]) => makeChainable(getValue),
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(getValue()).then(res, rej),
  };
  return self;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => makeChainable(() => mockRows.value) }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mockUpdateRows.value),
        }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve(mockUpdateRows.value),
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
        onConflictDoUpdate: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
  },
  eventsTable: {
    id: "id", hostId: "host_id", rsvps: "rsvps", type: "type",
    squadId: "squad_id", eventAt: "event_at", endAt: "end_at",
    createdAt: "created_at", version: "version", invitedUserIds: "invited_user_ids",
    cancelled: "cancelled",
  },
  eventInvitesTable: {
    id: "id", eventId: "event_id", inviterUserId: "inviter_user_id",
    invitedUserId: "invited_user_id", status: "status", createdAt: "created_at",
  },
}));

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue(null),
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
    countUserEventsThisYear: vi.fn().mockResolvedValue(0),
    getSubscription: vi.fn().mockResolvedValue(null),
    getActiveSubscriptionByCustomerId: vi.fn().mockResolvedValue(null),
    getPhotosByEventId: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockResolvedValue(null),
    getSquad: vi.fn().mockResolvedValue(null),
    getSquadIdsForUser: vi.fn().mockResolvedValue([]),
    getFriendIds: vi.fn().mockResolvedValue([]),
    filterUnmutedForSquad: vi.fn().mockImplementation((ids: string[]) => Promise.resolve(ids)),
    getPushTokensForUsers: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(undefined),
}));

import eventsRouter from "../routes/events";
import { makeTestApp } from "./helpers/makeTestApp";
import { HOST_ID, makeBaseEvent } from "./helpers/fixtures";

const DEPARTED_USER = "departed-member-id";
const COST_ID = "cost-1";

function makeEventWithCostAndDepartedMember(cancelled: boolean) {
  return makeBaseEvent({
    version: 3,
    cancelled,
    // DEPARTED_USER is no longer in rsvps (they left) but their share persists.
    rsvps: { [HOST_ID]: "going" },
    costs: [
      {
        id: COST_ID,
        description: "Dinner",
        amount: 60,
        paidById: HOST_ID,
        shares: [
          { userId: HOST_ID, amount: 30, paidAt: null, confirmedAt: null },
          // Departed user still owes their share — the server preserves this.
          { userId: DEPARTED_USER, amount: 30, paidAt: null, confirmedAt: null },
        ],
      },
    ],
  });
}

const makeApp = () => makeTestApp(eventsRouter, { id: HOST_ID });

beforeEach(() => {
  vi.clearAllMocks();
});

// ── D4: cancelled flag is present on GET response ────────────────────────────

describe("D4 — GET /api/events/:id — cancelled flag visible for client filtering", () => {
  it("returns cancelled:true on a cancelled event so the client can exclude it from settle-up", async () => {
    const ev = makeEventWithCostAndDepartedMember(true);
    mockRows.value = [ev];
    const res = await request(makeApp()).get("/api/events/evt-1");
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(true);
  });

  it("returns cancelled:false on a live event", async () => {
    const ev = makeEventWithCostAndDepartedMember(false);
    mockRows.value = [ev];
    const res = await request(makeApp()).get("/api/events/evt-1");
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(false);
  });
});

// ── D4: PATCH persists the cancelled flag ─────────────────────────────────────

describe("D4 — PATCH /api/events/:id cancelled:true is persisted and returned", () => {
  it("stores cancelled:true and returns it so subsequent GETs see the flag", async () => {
    const ev = makeEventWithCostAndDepartedMember(false);
    mockRows.value = [ev];
    mockUpdateRows.value = [{ ...ev, cancelled: true, version: 4 }];
    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({ cancelled: true, version: 3 });
    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(true);
  });
});

// ── D4: departed member share preserved in cost payload ──────────────────────

describe("D4 — GET /api/events/:id — departed member share is preserved in cost data", () => {
  it("costs still include shares from departed members so the client can render them gracefully", async () => {
    const ev = makeEventWithCostAndDepartedMember(false);
    mockRows.value = [ev];
    const res = await request(makeApp()).get("/api/events/evt-1");
    expect(res.status).toBe(200);
    const costs = res.body.costs as Array<{
      id: string;
      shares: Array<{ userId: string }>;
    }>;
    const cost = costs.find((c) => c.id === COST_ID);
    expect(cost).toBeDefined();
    const userIds = cost!.shares.map((s) => s.userId);
    // Departed user's share must remain in the payload.
    expect(userIds).toContain(DEPARTED_USER);
    expect(userIds).toContain(HOST_ID);
  });
});

// ── D4: settle-up context — list returns both live and cancelled events ───────

describe("D4 — GET /api/events — returns all events with cancelled flag for client to filter", () => {
  it("list includes cancelled events (with cancelled:true) so client settleup can exclude them", async () => {
    const liveEvent = makeEventWithCostAndDepartedMember(false);
    const cancelledEvent = { ...makeEventWithCostAndDepartedMember(true), id: "evt-2" };
    mockRows.value = [liveEvent, cancelledEvent];
    const res = await request(makeApp()).get("/api/events");
    expect(res.status).toBe(200);
    const events = res.body as Array<{ id: string; cancelled: boolean }>;
    const live = events.find((e) => e.id === "evt-1");
    const cancelled = events.find((e) => e.id === "evt-2");
    expect(live?.cancelled).toBe(false);
    expect(cancelled?.cancelled).toBe(true);
  });
});
