import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Captures the values handed to `db.insert(...).values(...)` for the event row,
// so we can assert the trip is created COMPLETE: the full inclusive date range
// plus any template stops, all in the one create request. Post-creation
// itinerary writes are what used to leave a half-built trip behind.
const dbState = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  insertRows: [] as unknown[],
  capturedInsert: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(dbState.selectRows),
        orderBy: () => Promise.resolve(dbState.selectRows),
      }),
    }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        if ("hostId" in vals || "rsvps" in vals) dbState.capturedInsert = vals;
        return { returning: () => Promise.resolve(dbState.insertRows) };
      },
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  },
  eventsTable: {
    id: "id",
    hostId: "host_id",
    rsvps: "rsvps",
    itinerary: "itinerary",
    startAt: "start_at",
    endAt: "end_at",
    createdAt: "created_at",
    inviteCode: "invite_code",
  },
  eventCreationsTable: { userId: "user_id", eventId: "event_id", createdAt: "created_at" },
  availabilityPollsTable: { id: "id", convertedEventId: "converted_event_id" },
  usersTable: {},
}));

const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  upsertUser: vi.fn(),
  getSubscription: vi.fn(),
  getActiveSubscriptionByCustomerId: vi.fn(),
  countUserEventsThisYear: vi.fn(),
  getSquad: vi.fn(),
  getFriendIds: vi.fn(),
  getAvailabilityPoll: vi.fn(),
  filterUnmutedForSquad: vi.fn(),
  getPushTokensForUsers: vi.fn(),
  clearPushToken: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({
  sendPushNotifications: vi.fn().mockResolvedValue({ staleTokens: [] }),
}));

import eventsRouter from "../routes/events";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(eventsRouter, user);

const HOST = "host-id";

type Stop = {
  day: string;
  title: string;
  status: string;
  createdBy: string;
  sortOrder: number;
  votes: string[];
};

const capturedStops = (): Stop[] => (dbState.capturedInsert?.itinerary ?? []) as Stop[];

beforeEach(() => {
  vi.clearAllMocks();
  dbState.selectRows = [];
  dbState.insertRows = [{ id: "evt-1", hostId: HOST }];
  dbState.capturedInsert = undefined;
  storageMock.getUser.mockResolvedValue({ id: HOST, email: "h@x.io" });
  storageMock.upsertUser.mockResolvedValue({ id: HOST });
  storageMock.getSubscription.mockResolvedValue(null);
  storageMock.getActiveSubscriptionByCustomerId.mockResolvedValue(null);
  storageMock.countUserEventsThisYear.mockResolvedValue(0);
  storageMock.getSquad.mockResolvedValue({ id: "squad-1", name: "Crew", memberIds: [HOST] });
  storageMock.getFriendIds.mockResolvedValue([]);
  storageMock.getAvailabilityPoll.mockResolvedValue(null);
  storageMock.filterUnmutedForSquad.mockImplementation(async (ids: string[]) => ids);
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.clearPushToken.mockResolvedValue(undefined);
});

describe("POST /api/events — trip dates are complete at creation", () => {
  it("keeps the full inclusive range the user locked in", async () => {
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events").send({
      title: "Lake weekend",
      type: "trip",
      squadId: "squad-1",
      startAt: "2026-07-01T09:00:00.000Z",
      endAt: "2026-07-04T18:00:00.000Z",
    });

    expect(res.status).toBe(201);
    expect((dbState.capturedInsert?.startAt as Date).toISOString()).toBe("2026-07-01T09:00:00.000Z");
    expect((dbState.capturedInsert?.endAt as Date).toISOString()).toBe("2026-07-04T18:00:00.000Z");
    // eventAt mirrors startAt so reminder/expiry logic still has a value.
    expect((dbState.capturedInsert?.eventAt as Date).toISOString()).toBe("2026-07-01T09:00:00.000Z");
  });

  it("defaults a missing end date to the start so a trip always has a range", async () => {
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events").send({
      title: "Day trip",
      type: "trip",
      squadId: "squad-1",
      startAt: "2026-07-01T09:00:00.000Z",
    });

    expect(res.status).toBe(201);
    expect((dbState.capturedInsert?.endAt as Date).toISOString()).toBe("2026-07-01T09:00:00.000Z");
  });

  it("rejects a trip with no start date instead of creating a dateless trip", async () => {
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events").send({
      title: "Someday",
      type: "trip",
      squadId: "squad-1",
    });

    expect(res.status).toBe(400);
    expect(dbState.capturedInsert).toBeUndefined();
  });

  it("rejects an end date before the start date", async () => {
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events").send({
      title: "Backwards",
      type: "trip",
      squadId: "squad-1",
      startAt: "2026-07-04T09:00:00.000Z",
      endAt: "2026-07-01T18:00:00.000Z",
    });

    expect(res.status).toBe(400);
    expect(dbState.capturedInsert).toBeUndefined();
  });
});

describe("POST /api/events — template stops ship with the trip", () => {
  it("stores the stops on the created trip in one write", async () => {
    const app = await makeApp({ id: HOST });
    const res = await request(app)
      .post("/api/events")
      .send({
        title: "Beach week",
        type: "trip",
        squadId: "squad-1",
        startAt: "2026-07-01T09:00:00.000Z",
        endAt: "2026-07-03T18:00:00.000Z",
        initialItinerary: [
          { day: "2026-07-01", time: "3:00 PM", title: "Check in", placeName: "Rental", category: "lodging" },
          { day: "2026-07-01", time: "7:00 PM", title: "Dinner", placeName: "Seafood", category: "food" },
          { day: "2026-07-02", time: "10:00 AM", title: "Beach", placeName: "Main beach", category: "activity" },
        ],
      });

    expect(res.status).toBe(201);
    const stops = capturedStops();
    expect(stops.map((s) => s.title)).toEqual(["Check in", "Dinner", "Beach"]);
    // Ordering restarts per day, matching the itinerary endpoint's convention.
    expect(stops.map((s) => [s.day, s.sortOrder])).toEqual([
      ["2026-07-01", 0],
      ["2026-07-01", 1],
      ["2026-07-02", 0],
    ]);
  });

  it("assigns server-owned authorship and status rather than trusting the client", async () => {
    const app = await makeApp({ id: HOST });
    const res = await request(app)
      .post("/api/events")
      .send({
        title: "Beach week",
        type: "trip",
        squadId: "squad-1",
        startAt: "2026-07-01T09:00:00.000Z",
        initialItinerary: [{ day: "2026-07-01", title: "Check in" }],
      });

    expect(res.status).toBe(201);
    const [stop] = capturedStops();
    expect(stop.createdBy).toBe(HOST);
    expect(stop.status).toBe("confirmed");
    expect(stop.votes).toEqual([]);
    expect(typeof (stop as unknown as { id: string }).id).toBe("string");
  });

  it("refuses an itinerary on a plain event", async () => {
    const app = await makeApp({ id: HOST });
    const res = await request(app)
      .post("/api/events")
      .send({
        title: "BBQ",
        type: "event",
        squadId: "squad-1",
        date: "TBD",
        initialItinerary: [{ day: "2026-07-01", title: "Check in" }],
      });

    expect(res.status).toBe(400);
    expect(dbState.capturedInsert).toBeUndefined();
  });

  it("leaves the itinerary unset when no template stops are sent", async () => {
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events").send({
      title: "Lake weekend",
      type: "trip",
      squadId: "squad-1",
      startAt: "2026-07-01T09:00:00.000Z",
    });

    expect(res.status).toBe(201);
    expect(dbState.capturedInsert?.itinerary).toBeUndefined();
  });
});
