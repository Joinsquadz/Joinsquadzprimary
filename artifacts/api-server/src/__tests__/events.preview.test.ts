import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const mockEventRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const mockUserRows = vi.hoisted(() => ({ value: [] as unknown[] }));
const selectCall = vi.hoisted(() => ({ count: 0 }));

vi.mock("@workspace/db", () => ({
  db: {
    // First select() in the route resolves the event; the second resolves the
    // host user. Alternate the returned rows by call order.
    select: () => {
      const isEventQuery = selectCall.count++ % 2 === 0;
      return {
        from: () => ({
          where: () =>
            Promise.resolve(isEventQuery ? mockEventRows.value : mockUserRows.value),
        }),
      };
    },
  },
  eventsTable: {
    id: "id",
    inviteCode: "invite_code",
    hostId: "host_id",
    rsvps: "rsvps",
    cancelled: "cancelled",
    eventAt: "event_at",
    startAt: "start_at",
    allDay: "all_day",
  },
  usersTable: {
    id: "id",
    firstName: "first_name",
    lastName: "last_name",
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
  },
}));

vi.mock("../lib/logger");

import eventsRouter from "../routes/events";
import { makeTestApp } from "./helpers/makeTestApp";
import { makeBaseEvent } from "./helpers/fixtures";

// Invite fallback pages only need event-vs-trip context before authentication.
// The public endpoint must never expose identity, time, place, or attendance.
const makeApp = () => makeTestApp(eventsRouter, { id: "viewer-1" });
const SECURE_CODE = "PL-ABCDEFGHJKLMNPQRSTUV";

beforeEach(() => {
  selectCall.count = 0;
  mockEventRows.value = [];
  mockUserRows.value = [];
});

describe("GET /api/events/preview", () => {
  it("returns a lightweight preview without authentication", async () => {
    mockEventRows.value = [makeBaseEvent()];
    const app = makeTestApp(eventsRouter);
    const res = await request(app).get(`/api/events/preview?code=${SECURE_CODE}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: "event" });
    expect(res.body.title).toBeUndefined();
    expect(res.body.hostName).toBeUndefined();
    expect(res.body.location).toBeUndefined();
    expect(res.body.goingCount).toBeUndefined();
    expect(res.body.rsvps).toBeUndefined();
  });

  it("never exposes private event details from the public preview", async () => {
    mockEventRows.value = [
      makeBaseEvent({
        emoji: "🥳",
        title: "Birthday Bash",
        date: "2026-08-01",
        location: "The Park",
        rsvps: { a: "going", b: "going", c: "maybe" },
      }),
    ];
    mockUserRows.value = [{ firstName: "Sam", lastName: "Rivera" }];

    const app = makeApp();
    const res = await request(app).get(`/api/events/preview?code=${SECURE_CODE}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: "event" });
    expect(res.body.rsvps).toBeUndefined();
    expect(res.body.messages).toBeUndefined();
    expect(res.body.costs).toBeUndefined();
  });

  it("does not expose absolute times from the public preview", async () => {
    // The stored `date` is the creator's wall-clock text. Without the absolute
    // instant the invite screen can only echo the creator's timezone, which
    // misdates the event for anyone joining from elsewhere.
    mockEventRows.value = [
      makeBaseEvent({
        date: "Wed, Jul 15 · 6:00 PM",
        eventAt: "2026-07-16T01:00:00.000Z",
        startAt: "2026-07-16T01:00:00.000Z",
        allDay: false,
      }),
    ];
    mockUserRows.value = [{ firstName: "Sam", lastName: "Rivera" }];

    const app = makeApp();
    const res = await request(app).get(`/api/events/preview?code=${SECURE_CODE}`);

    expect(res.status).toBe(200);
    expect(res.body.eventAt).toBeUndefined();
    expect(res.body.startAt).toBeUndefined();
    expect(res.body.date).toBeUndefined();
  });

  it("does not expose host identity", async () => {
    mockEventRows.value = [makeBaseEvent()];
    mockUserRows.value = [];

    const app = makeApp();
    const res = await request(app).get(`/api/events/preview?code=${SECURE_CODE}`);

    expect(res.status).toBe(200);
    expect(res.body.hostName).toBeUndefined();
  });

  it("returns 404 when the code is missing", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/events/preview");
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown code", async () => {
    mockEventRows.value = [];
    const app = makeApp();
    const res = await request(app).get("/api/events/preview?code=PL-ZYXWVUTSRQPNMLKJHGFE");
    expect(res.status).toBe(404);
  });

  it("returns no public content for enumerable legacy short codes", async () => {
    mockEventRows.value = [makeBaseEvent()];
    const res = await request(makeTestApp(eventsRouter)).get("/api/events/preview?code=SQ-ABCD");
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
  });

  it("reports the plan type so a trip invite opens the trip screen", async () => {
    // Trips share the events table but have their own detail route. Without
    // the type the invite screen sent every accepted invite to /event/:id,
    // so a trip showed as an event until the user left and came back.
    mockEventRows.value = [makeBaseEvent({ type: "trip" })];
    mockUserRows.value = [{ firstName: "Sam", lastName: "Rivera" }];

    const app = makeApp();
    const res = await request(app).get(`/api/events/preview?code=${SECURE_CODE}`);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("trip");
  });

  it("defaults the plan type to event for legacy rows with no type", async () => {
    mockEventRows.value = [makeBaseEvent({ type: undefined })];
    mockUserRows.value = [];

    const app = makeApp();
    const res = await request(app).get(`/api/events/preview?code=${SECURE_CODE}`);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("event");
  });

  it("returns 410 for a cancelled event", async () => {
    mockEventRows.value = [makeBaseEvent({ cancelled: true })];
    const app = makeApp();
    const res = await request(app).get(`/api/events/preview?code=${SECURE_CODE}`);
    expect(res.status).toBe(410);
  });

  it("includes type=trip for a trip so the join screen routes to /trip/[id]", async () => {
    mockEventRows.value = [makeBaseEvent({ type: "trip" })];
    mockUserRows.value = [{ firstName: "Sam", lastName: "Rivera" }];

    const app = makeApp();
    const res = await request(app).get(`/api/events/preview?code=${SECURE_CODE}`);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("trip");
  });

  it("includes type=event for a normal event so the join screen routes to /event/[id]", async () => {
    mockEventRows.value = [makeBaseEvent({ type: "event" })];
    mockUserRows.value = [{ firstName: "Sam", lastName: "Rivera" }];

    const app = makeApp();
    const res = await request(app).get(`/api/events/preview?code=${SECURE_CODE}`);

    expect(res.status).toBe(200);
    expect(res.body.type).toBe("event");
  });
});
