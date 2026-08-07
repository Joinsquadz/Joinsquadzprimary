/**
 * C2 regression: the material-edit notification cooldown must be an atomic
 * UPDATE…WHERE…RETURNING rather than a read-then-write pattern.
 *
 * Key invariant: the decision to send a push is now driven entirely by whether
 * db.update(eventsTable).where(cooldown-condition).returning() returns a row —
 * NOT by reading event.materialEditNotifiedAt from the in-memory event snapshot.
 * Two concurrent PATCH requests race on that single UPDATE; only the winner
 * (whose RETURNING has a row) fires the push. The loser gets 0 rows and skips.
 *
 * Tests:
 *   1. Push fires when the cooldown UPDATE returns a row (stamp wins the race).
 *   2. Push is suppressed when the cooldown UPDATE returns 0 rows (stamp loses),
 *      EVEN IF the in-memory event has materialEditNotifiedAt = null — proving
 *      the decision is now DB-driven, not snapshot-driven.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const mockSelectRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockReturningFn = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockSelectRows.value),
        orderBy: () => Promise.resolve(mockSelectRows.value),
      }),
    }),
    // Each call to .update().set().where().returning() delegates to mockReturningFn
    // so tests can control the return value per-call (main event update vs cooldown stamp).
    update: () => ({
      set: () => ({
        where: () => ({
          returning: mockReturningFn,
        }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
    insert: () => ({
      values: () => ({
        returning: () => Promise.resolve([]),
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
        onConflictDoUpdate: () => ({ returning: () => Promise.resolve([]) }),
      }),
    }),
  },
  eventsTable: {
    id: "id", hostId: "host_id", rsvps: "rsvps", type: "type",
    squadId: "squad_id", eventAt: "event_at", endAt: "end_at",
    createdAt: "created_at", version: "version",
    invitedUserIds: "invited_user_ids", cancelled: "cancelled",
    materialEditNotifiedAt: "material_edit_notified_at",
    title: "title", location: "location", date: "date",
  },
  eventInvitesTable: {
    id: "id", eventId: "event_id", invitedUserId: "invited_user_id",
    status: "status", createdAt: "created_at",
  },
  eventCreationsTable: { userId: "user_id", yearMonth: "year_month", count: "count" },
  usersTable: { id: "id", isSquadzPlus: "is_squadz_plus", foundingMember: "founding_member", moderationHidden: "moderation_hidden" },
  activityTable: { id: "id", type: "type", subjectId: "subject_id", userId: "user_id" },
}));

const pushMock = vi.hoisted(() => ({ sendPushNotifications: vi.fn() }));
vi.mock("../lib/pushNotifications", () => pushMock);

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "host-id" }),
    upsertUser: vi.fn().mockResolvedValue({ id: "host-id" }),
    countUserEventsThisYear: vi.fn().mockResolvedValue(0),
    getSubscription: vi.fn().mockResolvedValue(null),
    getActiveSubscriptionByCustomerId: vi.fn().mockResolvedValue(null),
    getPhotosByEventId: vi.fn().mockResolvedValue([]),
    getEvent: vi.fn().mockResolvedValue(null),
    getSquad: vi.fn().mockResolvedValue(null),
    getSquadIdsForUser: vi.fn().mockResolvedValue([]),
    getFriendIds: vi.fn().mockResolvedValue([]),
    filterUnmutedForSquad: vi.fn().mockImplementation((ids: string[]) => Promise.resolve(ids)),
    getPushTokensForUsers: vi.fn().mockResolvedValue(["ExponentPushToken[test-token]"]),
    clearPushToken: vi.fn(),
  },
}));

vi.mock("../lib/logger");

import eventsRouter from "../routes/events";
import { makeTestApp } from "./helpers/makeTestApp";
import { HOST_ID, makeBaseEvent } from "./helpers/fixtures";

const app = makeTestApp(eventsRouter, { id: HOST_ID });

/** Full event row with materialEditNotifiedAt = null (never notified). */
const baseEvent = {
  ...makeBaseEvent(),
  materialEditNotifiedAt: null,
  cancelled: false,
  title: "Summer BBQ",
  location: "Central Park",
  date: "2026-08-10",
};

function patchBody(overrides = {}) {
  return { title: "Updated BBQ", version: baseEvent.version, ...overrides };
}

/** Flush the microtask queue so fire-and-forget async blocks settle. */
const flushAsync = () => new Promise((r) => setTimeout(r, 50));

beforeEach(() => {
  vi.clearAllMocks();
  mockReturningFn.mockReset();
  // The event SELECT (existing-event lookup) must return the event so the
  // PATCH handler proceeds past the 404 guard.
  mockSelectRows.value = [baseEvent];
});

describe("material-edit cooldown — atomic UPDATE…RETURNING", () => {
  it("fires push when the cooldown stamp UPDATE returns a row (winner)", async () => {
    // The PATCH handler makes 2 .returning() calls:
    //   1. Main event update (version-check) → must return the event row to proceed.
    //   2. Cooldown stamp UPDATE → returns [{ id }] = this process wins the race.
    mockReturningFn
      .mockResolvedValueOnce([baseEvent])  // main event update succeeds
      .mockResolvedValueOnce([{ id: HOST_ID }]); // cooldown stamp: winner

    const res = await request(app).patch(`/api/events/${baseEvent.id}`).send(patchBody());
    expect(res.status).toBe(200);
    await flushAsync();
    expect(pushMock.sendPushNotifications).toHaveBeenCalledTimes(1);
  });

  it("suppresses push when the cooldown stamp UPDATE returns 0 rows (loser)", async () => {
    // The event has materialEditNotifiedAt = null in the snapshot, but the
    // DB's atomic UPDATE returns 0 rows — meaning another concurrent request
    // already stamped the cooldown. Push must NOT fire.
    mockReturningFn
      .mockResolvedValueOnce([baseEvent])  // main event update succeeds
      .mockResolvedValueOnce([]);          // cooldown stamp: loser (cooldown already active)

    const res = await request(app).patch(`/api/events/${baseEvent.id}`).send(patchBody());
    expect(res.status).toBe(200);
    await flushAsync();
    // Key assertion: even though event.materialEditNotifiedAt === null in-memory,
    // the DB-driven result (0 rows) suppresses the push.
    expect(pushMock.sendPushNotifications).not.toHaveBeenCalled();
  });

  it("does not fire push for emoji-only or description-only edits (non-material)", async () => {
    mockReturningFn.mockResolvedValueOnce([baseEvent]); // main event update only

    const res = await request(app)
      .patch(`/api/events/${baseEvent.id}`)
      .send({ emoji: "🎉", version: baseEvent.version });
    expect(res.status).toBe(200);
    await flushAsync();
    // Non-material edit: cooldown stamp UPDATE is never called, push never fires.
    expect(pushMock.sendPushNotifications).not.toHaveBeenCalled();
  });
});
