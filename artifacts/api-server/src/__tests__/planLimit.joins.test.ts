/**
 * Free-tier plan slots are consumed by JOINING, not just by creating.
 *
 * The cap is 3 plans (events and trips combined) in a rolling 12-month window,
 * counted off the append-only `event_creations` ledger. Every way of taking
 * part in a plan spends a slot:
 *   • creating one            (routes/events.ts, inside the create tx)
 *   • RSVPing "going"         (POST /events/:id/rsvp)
 *   • joining by invite code  (POST /events/join)
 *   • accepting an invitation (POST /events/invites/:id/accept)
 *
 * Rules verified here:
 *  1. RSVP "going" claims a slot; maybe/notgoing do NOT (they aren't
 *     participation, so sitting on the fence stays free).
 *  2. A capped user is blocked with a machine-readable PLAN_LIMIT 403, and the
 *     plan is NOT half-joined (no RSVP write happens).
 *  3. Re-RSVPing / re-joining a plan you already have a ledger row for is a
 *     no-op — it must be allowed through even when the user is at the cap,
 *     otherwise changing your mind twice would start failing.
 *  4. Pro users are never blocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const planState = vi.hoisted(() => ({
  /** Slots already consumed in the window. */
  used: 0,
  /** Whether a ledger row already exists for this (user, plan). */
  alreadyClaimed: false,
  /** Ledger rows inserted during the request. */
  inserted: [] as Record<string, unknown>[],
  /** The event row returned by lookups/updates. */
  eventRow: {} as Record<string, unknown>,
  /** RSVP update writes that reached the DB. */
  rsvpWrites: 0,
  /** Simulates the plan vanishing mid-flight (update matches 0 rows). */
  writeMatchesZeroRows: false,
  /** Simulates the participation write failing outright. */
  throwOnWrite: false,
  /** True when the transaction callback threw (i.e. Postgres would ROLLBACK). */
  txRolledBack: false,
}));

vi.mock("@workspace/db", () => {
  // Thenable chain: the cap count resolves via await, the "already claimed?"
  // probe via .limit(), and the oldest-row query via .orderBy().limit().
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

  const insert = () => ({
    values: (v: Record<string, unknown>) => {
      planState.inserted.push(v);
      return {
        returning: () => Promise.resolve([]),
        onConflictDoNothing: () => Promise.resolve(undefined),
      };
    },
  });

  return {
    db: {
      select: () => chain([planState.eventRow]),
      insert,
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => {
              planState.rsvpWrites++;
              return Promise.resolve([planState.eventRow]);
            },
          }),
        }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        let selectN = 0;
        const tx = {
          execute: vi.fn().mockResolvedValue({ rows: [] }),
          select: () => {
            selectN++;
            // 1st select inside withPlanSlot: the "already claimed?" probe
            // (taken AFTER the advisory lock). 2nd: the window count. 3rd: the
            // oldest-row query for nextSlotAvailableAt.
            if (selectN === 1) return chain(planState.alreadyClaimed ? [{ id: 1 }] : []);
            if (selectN === 2) return chain([{ count: planState.used }]);
            return chain([{ createdAt: new Date("2026-02-01T00:00:00Z") }]);
          },
          insert,
          // The participation write now runs INSIDE this transaction, so the
          // tx executor must model update() too.
          update: () => ({
            set: () => ({
              where: () => ({
                returning: () => {
                  planState.rsvpWrites++;
                  if (planState.throwOnWrite) {
                    return Promise.reject(new Error("simulated write failure"));
                  }
                  return Promise.resolve(
                    planState.writeMatchesZeroRows ? [] : [planState.eventRow],
                  );
                },
              }),
            }),
          }),
          delete: () => ({ where: () => Promise.resolve() }),
        };
        try {
          return await fn(tx);
        } catch (err) {
          // Real Postgres discards everything the callback wrote, ledger row
          // included; the mock records that the rollback happened.
          planState.txRolledBack = true;
          planState.inserted = [];
          throw err;
        }
      }),
    },
    eventsTable: {
      id: "id", hostId: "host_id", rsvps: "rsvps", version: "version",
      cancelled: "cancelled", invitedUserIds: "invited_user_ids",
      inviteCode: "invite_code", eventAt: "event_at", endAt: "end_at",
      squadId: "squad_id", type: "type", createdAt: "created_at",
    },
    eventCreationsTable: {
      id: "id", userId: "user_id", eventId: "event_id",
      source: "source", createdAt: "created_at",
    },
    usersTable: {},
    squadsTable: { id: "id", memberIds: "member_ids" },
    activityTable: { id: "id", type: "type", subjectId: "subject_id", userId: "user_id" },
  };
});

const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  upsertUser: vi.fn(),
  getSubscription: vi.fn().mockResolvedValue(null),
  getActiveSubscriptionByCustomerId: vi.fn().mockResolvedValue(null),
  countUserEventsThisYear: vi.fn().mockResolvedValue(0),
  countUserEventCreationsInWindow: vi.fn().mockResolvedValue(0),
  getOldestEventCreationAt: vi.fn().mockResolvedValue(null),
  getSquad: vi.fn().mockResolvedValue(null),
  getEvent: vi.fn().mockResolvedValue(null),
  filterUnmutedForSquad: vi.fn(async (ids: string[]) => ids),
  getPushTokensForUsers: vi.fn().mockResolvedValue([]),
  clearPushToken: vi.fn(),
  getFriendIds: vi.fn().mockResolvedValue([]),
  getSquadIdsForUser: vi.fn().mockResolvedValue([]),
  getPhotosByEventId: vi.fn().mockResolvedValue([]),
}));

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue({ staleTokens: [] }),
}));
vi.mock("../lib/eventUpdates", () => ({
  emitEventUpdate: vi.fn(),
  onEventUpdate: vi.fn(() => () => {}),
}));
vi.mock("../lib/activity", () => ({
  recordActivitySafe: vi.fn(),
  removeActivity: vi.fn(),
}));

import eventsRouter from "../routes/events";
import { FREE_PLAN_LIMIT } from "../lib/planLimit";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const FREE_USER: TestUser = { id: "user-free", email: "free@test.com" };
const makeApp = (user?: TestUser) => makeTestApp(eventsRouter, user);

/** A future event the user has been invited to. */
function futureEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    hostId: "someone-else",
    rsvps: {},
    version: 0,
    cancelled: false,
    invitedUserIds: [FREE_USER.id],
    inviteCode: "CODE1",
    eventAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    endAt: null,
    squadId: null,
    type: "event",
    title: "Dinner",
    emoji: "🍜",
    ...overrides,
  };
}

const ledgerRows = () => planState.inserted.filter((r) => "eventId" in r);

beforeEach(() => {
  vi.clearAllMocks();
  planState.used = 0;
  planState.alreadyClaimed = false;
  planState.inserted = [];
  planState.rsvpWrites = 0;
  planState.writeMatchesZeroRows = false;
  planState.throwOnWrite = false;
  planState.txRolledBack = false;
  planState.eventRow = futureEvent();
  storageMock.getUser.mockResolvedValue({
    id: FREE_USER.id,
    email: "free@test.com",
    stripeSubscriptionId: null,
    stripeCustomerId: null,
  });
  storageMock.upsertUser.mockResolvedValue({ id: FREE_USER.id });
  storageMock.getSubscription.mockResolvedValue(null);
  storageMock.getActiveSubscriptionByCustomerId.mockResolvedValue(null);
});

describe("RSVP 'going' consumes a plan slot", () => {
  it("writes a ledger row with source 'join'", async () => {
    const res = await request(makeApp(FREE_USER))
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going" });

    expect(res.status).toBe(200);
    expect(ledgerRows()).toHaveLength(1);
    expect(ledgerRows()[0]).toMatchObject({
      userId: FREE_USER.id,
      eventId: "evt-1",
      source: "join",
    });
  });

  it("does NOT consume a slot for 'maybe' or 'notgoing'", async () => {
    for (const status of ["maybe", "notgoing"]) {
      planState.inserted = [];
      const res = await request(makeApp(FREE_USER))
        .post("/api/events/evt-1/rsvp")
        .send({ status });

      expect(res.status).toBe(200);
      // Being undecided is not participation — it must stay free.
      expect(ledgerRows()).toHaveLength(0);
    }
  });

  it("blocks a capped user with a machine-readable PLAN_LIMIT 403", async () => {
    planState.used = FREE_PLAN_LIMIT;

    const res = await request(makeApp(FREE_USER))
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PLAN_LIMIT");
    expect(res.body.limit).toBe(FREE_PLAN_LIMIT);
    expect(res.body.requiresPro).toBe(true);
    // The slot is claimed BEFORE the RSVP write, so a capped user never
    // half-joins: no ledger row and no RSVP written.
    expect(ledgerRows()).toHaveLength(0);
    expect(planState.rsvpWrites).toBe(0);
  });

  it("still lets a capped user re-RSVP to a plan they already hold a slot for", async () => {
    planState.used = FREE_PLAN_LIMIT + 2; // over the cap (legacy user)
    planState.alreadyClaimed = true;

    const res = await request(makeApp(FREE_USER))
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going" });

    // Re-confirming a plan you're already in charges nothing and must not fail
    // just because the account sits above the cap.
    expect(res.status).toBe(200);
    expect(ledgerRows()).toHaveLength(0);
  });

  it("never blocks a Pro user", async () => {
    planState.used = FREE_PLAN_LIMIT + 5;
    storageMock.getUser.mockResolvedValue({
      id: FREE_USER.id,
      email: "pro@test.com",
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_1",
    });
    storageMock.getSubscription.mockResolvedValue({ status: "active" });

    const res = await request(makeApp(FREE_USER))
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going" });

    expect(res.status).toBe(200);
    // Pro still records the row (so downgrading later counts it), it just
    // skips the cap check.
    expect(ledgerRows()).toHaveLength(1);
  });
});

describe("joining by invite code consumes a plan slot", () => {
  it("writes a ledger row and lets the join through", async () => {
    const res = await request(makeApp(FREE_USER))
      .post("/api/events/join")
      .send({ inviteCode: "CODE1" });

    expect(res.status).toBe(200);
    expect(ledgerRows()).toHaveLength(1);
    expect(ledgerRows()[0]).toMatchObject({ eventId: "evt-1", source: "join" });
  });

  it("blocks a capped user before any RSVP write", async () => {
    planState.used = FREE_PLAN_LIMIT;

    const res = await request(makeApp(FREE_USER))
      .post("/api/events/join")
      .send({ inviteCode: "CODE1" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PLAN_LIMIT");
    expect(planState.rsvpWrites).toBe(0);
  });
});

describe("a slot is never spent on a plan the user did not join", () => {
  it("charges nothing when the RSVP write matches zero rows (plan deleted mid-flight)", async () => {
    planState.writeMatchesZeroRows = true;

    const res = await request(makeApp(FREE_USER))
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going" });

    expect(res.status).toBe(404);
    // The ledger row and the RSVP share one transaction, and the charge is
    // gated on the write actually matching — otherwise a plan that vanished
    // between the lookup and the write would burn 1 of only 3 free slots
    // forever, with nothing to show for it.
    expect(ledgerRows()).toHaveLength(0);
  });

  it("rolls the ledger row back when the participation write throws", async () => {
    // A throw inside the action must propagate and abort the transaction,
    // taking any ledger insert with it. Modelled here by making the tx's
    // update() blow up the way a real constraint violation would.
    planState.throwOnWrite = true;

    const res = await request(makeApp(FREE_USER))
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going" });

    expect(res.status).toBe(500);
    expect(planState.txRolledBack).toBe(true);
  });
});

describe("trips draw from the same pool as events", () => {
  it("charges a slot for RSVPing 'going' to a trip", async () => {
    planState.eventRow = futureEvent({ type: "trip", endAt: new Date(Date.now() + 9e8) });

    const res = await request(makeApp(FREE_USER))
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going" });

    expect(res.status).toBe(200);
    // Events and trips are the SAME `events` row and the SAME ledger — a trip
    // is not a free extra plan.
    expect(ledgerRows()).toHaveLength(1);
  });
});
