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

const makeApp = () => makeTestApp(eventsRouter);

beforeEach(() => {
  selectCall.count = 0;
  mockEventRows.value = [];
  mockUserRows.value = [];
});

describe("GET /api/events/preview", () => {
  it("returns a public preview without authentication", async () => {
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
    const res = await request(app).get("/api/events/preview?code=SQ-ABCD");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      emoji: "🥳",
      title: "Birthday Bash",
      hostName: "Sam Rivera",
      date: "2026-08-01",
      location: "The Park",
      goingCount: 2,
    });
    // Never leak chat, costs, member ids, or raw rsvps.
    expect(res.body.rsvps).toBeUndefined();
    expect(res.body.messages).toBeUndefined();
    expect(res.body.costs).toBeUndefined();
  });

  it("returns null hostName when the host has no name", async () => {
    mockEventRows.value = [makeBaseEvent()];
    mockUserRows.value = [];

    const app = makeApp();
    const res = await request(app).get("/api/events/preview?code=SQ-ABCD");

    expect(res.status).toBe(200);
    expect(res.body.hostName).toBeNull();
  });

  it("returns 404 when the code is missing", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/events/preview");
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown code", async () => {
    mockEventRows.value = [];
    const app = makeApp();
    const res = await request(app).get("/api/events/preview?code=NOPE");
    expect(res.status).toBe(404);
  });

  it("returns 410 for a cancelled event", async () => {
    mockEventRows.value = [makeBaseEvent({ cancelled: true })];
    const app = makeApp();
    const res = await request(app).get("/api/events/preview?code=SQ-ABCD");
    expect(res.status).toBe(410);
  });
});
