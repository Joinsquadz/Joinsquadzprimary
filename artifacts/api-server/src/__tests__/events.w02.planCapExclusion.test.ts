/**
 * W-02: Event plan-cap exclusion and nextSlotAvailableAt.
 *
 * Rules:
 *  1. Events that are (cancelled AND created < 1 hour ago AND no invites AND
 *     no RSVPs) are excluded from the cap count ("orphaned quick-cancels").
 *  2. The 403 cap error includes `nextSlotAvailableAt` — the ISO timestamp
 *     when the oldest counted slot expires.
 *  3. When the oldest-row query returns nothing, nextSlotAvailableAt is null.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Hoisted state controlling per-test mock behaviour ─────────────────────────
const capState = vi.hoisted(() => ({
  countToReturn: 0,
  oldestCreatedAt: new Date("2026-01-29T00:00:00Z"),
  selectN: 0,
  insertN: 0,
  noOldestRow: false,
  insertRows: [{ id: "evt-new", hostId: "user-free", rsvps: {}, version: 0 }] as unknown[],
}));

// ── @workspace/db mock ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  // Chainable, thenable select chain that supports leftJoin + orderBy + limit.
  // The chain is thenable (resolves directly when awaited) AND .limit() returns
  // a Promise — both patterns used by the cap-count and oldest-row queries.
  function chain(val: unknown): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      from: () => obj,
      leftJoin: () => obj,
      where: () => obj,
      orderBy: () => obj,
      limit: () => Promise.resolve(val),
      then: (r: (v: unknown) => unknown) => Promise.resolve(val).then(r),
    };
    return obj;
  }

  function txInsert(): Record<string, unknown> {
    return {
      values: () => {
        capState.insertN++;
        return capState.insertN === 1
          ? { returning: vi.fn().mockResolvedValue(capState.insertRows) }
          : { returning: vi.fn().mockResolvedValue([]) };
      },
    };
  }

  return {
    db: {
      // Outer selects (e.g. user lookup for isPro check): always return empty.
      select: vi.fn(() => chain([])),
      insert: vi.fn(() => chain([])),
      update: vi.fn(() => chain([])),
      delete: vi.fn(() => chain([])),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      transaction: vi.fn((fn: (tx: unknown) => unknown) => {
        capState.selectN = 0;
        capState.insertN = 0;
        const tx = {
          execute: vi.fn().mockResolvedValue({ rows: [] }),
          select: vi.fn(() => {
            capState.selectN++;
            // 1st select: cap count query.
            if (capState.selectN === 1) return chain([{ count: capState.countToReturn }]);
            // 2nd select: oldest-row query (nextSlotAvailableAt).
            return chain(capState.noOldestRow ? [] : [{ createdAt: capState.oldestCreatedAt }]);
          }),
          insert: vi.fn(() => txInsert()),
        };
        return fn(tx);
      }),
    },
    eventsTable: {
      id: "id", hostId: "host_id", cancelled: "cancelled",
      invitedUserIds: "invited_user_ids", rsvps: "rsvps",
      version: "version", type: "type",
    },
    eventCreationsTable: { userId: "user_id", eventId: "event_id", createdAt: "created_at" },
    usersTable: { id: "id", email: "email", isSquadzPlus: "is_squadz_plus", firstName: "first_name", lastName: "last_name" },
    squadsTable: { id: "id", memberIds: "member_ids" },
    squadInvitesTable: { id: "id", squadId: "squad_id", invitedUserId: "invited_user_id", status: "status" },
    squadMemberHistoryTable: { squadId: "squad_id", userId: "user_id" },
    eventInvitesTable: { id: "id", eventId: "event_id", invitedUserId: "invited_user_id", status: "status" },
    activityTable: { id: "id", recipientId: "recipient_id", type: "type", subjectId: "subject_id" },
    availabilityPollsTable: { id: "id" },
    revokedTokensTable: { tokenHash: "token_hash", userId: "user_id", expiresAt: "expires_at" },
    rateLimitsTable: { key: "key", count: "count", windowStart: "window_start" },
  };
});

// ── Storage mock (explicit factory — required for events router) ──────────────
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
vi.mock("../lib/eventUpdates", () => ({ emitEventUpdate: vi.fn(), onEventUpdate: vi.fn(() => () => {}) }));
vi.mock("../lib/squadEvents");
vi.mock("../lib/activity");

import eventsRouter from "../routes/events";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(eventsRouter, user);

const FREE_USER: TestUser = { id: "user-free", email: "free@test.com" };

const BASE_EVENT_BODY = {
  title: "Test event",
  eventAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  type: "event",
};

beforeEach(() => {
  vi.clearAllMocks();
  capState.countToReturn = 0;
  capState.selectN = 0;
  capState.insertN = 0;
  capState.oldestCreatedAt = new Date("2026-01-29T00:00:00Z");
  capState.noOldestRow = false;
  capState.insertRows = [{ id: "evt-new", hostId: "user-free", rsvps: {}, version: 0 }];

  storageMock.getUser.mockResolvedValue({ id: FREE_USER.id, isSquadzPlus: false });
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

// ── Orphaned-cancel exclusion ─────────────────────────────────────────────────

describe("W-02: orphaned quick-cancel events are excluded from the cap", () => {
  it("creates the event when counted slots are below the limit (exclusion in effect)", async () => {
    // Mock simulates the DB having excluded orphaned events: effective count = 4.
    capState.countToReturn = 4; // below FREE_EVENT_LIMIT (5)

    const res = await request(makeApp(FREE_USER))
      .post("/api/events")
      .send(BASE_EVENT_BODY);

    expect([200, 201]).toContain(res.status);
    expect(res.body.id).toBe("evt-new");
  });

  it("returns 403 when effective count is at the limit (real events, none orphaned)", async () => {
    capState.countToReturn = 5; // at FREE_EVENT_LIMIT

    const res = await request(makeApp(FREE_USER))
      .post("/api/events")
      .send(BASE_EVENT_BODY);

    expect(res.status).toBe(403);
    expect(res.body.requiresPro).toBe(true);
    expect(res.body.count).toBe(5);
    expect(res.body.limit).toBe(5);
  });
});

// ── nextSlotAvailableAt ───────────────────────────────────────────────────────

describe("W-02: nextSlotAvailableAt in the 403 cap response", () => {
  it("includes nextSlotAvailableAt as a valid ISO date approx 1 year after the oldest counted slot", async () => {
    capState.countToReturn = 5;
    capState.oldestCreatedAt = new Date("2026-01-01T10:00:00Z");

    const res = await request(makeApp(FREE_USER))
      .post("/api/events")
      .send(BASE_EVENT_BODY);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("nextSlotAvailableAt");
    const slot = new Date(res.body.nextSlotAvailableAt as string);
    expect(isNaN(slot.getTime())).toBe(false); // valid date
    // Should be ~1 year after oldestCreatedAt (EVENT_WINDOW_MS = 365 days).
    const diffMs = slot.getTime() - new Date("2026-01-01T10:00:00Z").getTime();
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    expect(Math.abs(diffMs - oneYearMs)).toBeLessThan(1000); // within 1s
  });

  it("returns nextSlotAvailableAt: null when the oldest-row query returns no rows", async () => {
    capState.countToReturn = 5;
    capState.noOldestRow = true; // oldest query returns []

    const res = await request(makeApp(FREE_USER))
      .post("/api/events")
      .send(BASE_EVENT_BODY);

    expect(res.status).toBe(403);
    expect(res.body.nextSlotAvailableAt).toBeNull();
  });
});
