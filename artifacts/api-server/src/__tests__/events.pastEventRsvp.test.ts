// C1 — server-side guard rejecting RSVPs once eventAt (or endAt for trips) is
// in the past. The route returns 410 "This event already happened — RSVPs are
// closed." and must pass through getEventAsMemberForWrite's cancelled check
// first (cancelled events return 410 for a different reason).
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUpdateRows = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockRows.value),
        orderBy: () => Promise.resolve(mockRows.value),
      }),
    }),
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
  eventCreationsTable: { id: "id", userId: "user_id", eventId: "event_id", source: "source", createdAt: "created_at" },
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

import eventsRouter from "../routes/events";
import { makeTestApp } from "./helpers/makeTestApp";
import { HOST_ID, RSVP_USER_ID, makeBaseEvent } from "./helpers/fixtures";

const makeApp = (userId = HOST_ID) => makeTestApp(eventsRouter, { id: userId });

const PAST = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
const FUTURE = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();

function pastEvent(overrides: Record<string, unknown> = {}) {
  return makeBaseEvent({
    version: 0,
    cancelled: false,
    eventAt: PAST,
    endAt: null,
    rsvps: { [RSVP_USER_ID]: "going" },
    ...overrides,
  });
}

function futureEvent(overrides: Record<string, unknown> = {}) {
  return makeBaseEvent({
    version: 0,
    cancelled: false,
    eventAt: FUTURE,
    endAt: null,
    rsvps: {},
    ...overrides,
  });
}

beforeEach(() => {
  mockUpdateRows.value = [];
});

describe("C1 — POST /api/events/:id/rsvp past-event guard", () => {
  it("returns 410 when eventAt is in the past (host)", async () => {
    mockRows.value = [pastEvent()];
    const res = await request(makeApp())
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going" });
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/already happened|RSVPs are closed/i);
  });

  it("returns 410 when eventAt is in the past (RSVP member)", async () => {
    mockRows.value = [pastEvent()];
    const res = await request(makeApp(RSVP_USER_ID))
      .post("/api/events/evt-1/rsvp")
      .send({ status: "notgoing" });
    expect(res.status).toBe(410);
  });

  it("returns 200 when eventAt is in the future", async () => {
    mockUpdateRows.value = [futureEvent({ rsvps: { [HOST_ID]: "going" } })];
    mockRows.value = [futureEvent()];
    const res = await request(makeApp())
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going" });
    expect(res.status).toBe(200);
  });

  it("uses endAt for trips — returns 410 when endAt is past even if eventAt is future", async () => {
    // Trip: eventAt in the future, endAt in the past.
    const trip = pastEvent({ eventAt: FUTURE, endAt: PAST, type: "trip" });
    mockRows.value = [trip];
    const res = await request(makeApp())
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going" });
    expect(res.status).toBe(410);
  });

  it("returns 200 for a trip when endAt is in the future", async () => {
    const trip = futureEvent({ endAt: FUTURE, type: "trip" });
    mockUpdateRows.value = [{ ...trip, rsvps: { [HOST_ID]: "going" } }];
    mockRows.value = [trip];
    const res = await request(makeApp())
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going" });
    expect(res.status).toBe(200);
  });

  it("returns 410 with past eventAt even when no endAt (plain event)", async () => {
    mockRows.value = [pastEvent({ endAt: null })];
    const res = await request(makeApp())
      .post("/api/events/evt-1/rsvp")
      .send({ status: "going" });
    expect(res.status).toBe(410);
  });
});
