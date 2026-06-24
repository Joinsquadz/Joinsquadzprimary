import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Captures the values handed to `db.insert(...).values(...)` so we can assert
// what the create route persists. A trip must seed the organizer as "going"
// (trips have no RSVP UI, so otherwise they'd show "0 going"); a plain event
// must NOT seed the host (events prompt the host to RSVP themselves).
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
        // The route inserts the event first, then a creations-ledger row. Only
        // capture the event insert (it carries `rsvps`/`hostId`).
        if ("hostId" in vals || "rsvps" in vals) dbState.capturedInsert = vals;
        return { returning: () => Promise.resolve(dbState.insertRows) };
      },
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  },
  eventsTable: { id: "id", hostId: "host_id", rsvps: "rsvps", createdAt: "created_at", inviteCode: "invite_code" },
  eventCreationsTable: { userId: "user_id", eventId: "event_id", createdAt: "created_at" },
  usersTable: {},
}));

const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  upsertUser: vi.fn(),
  getSubscription: vi.fn(),
  getActiveSubscriptionByCustomerId: vi.fn(),
  countUserEventsThisYear: vi.fn(),
  getSquad: vi.fn(),
  filterUnmutedForSquad: vi.fn(),
  getPushTokensForUsers: vi.fn(),
  clearPushToken: vi.fn(),
}));

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: vi.fn().mockResolvedValue({ staleTokens: [] }) }));

import eventsRouter from "../routes/events";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(eventsRouter, user);

const HOST = "host-id";

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
  storageMock.filterUnmutedForSquad.mockImplementation(async (ids: string[]) => ids);
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.clearPushToken.mockResolvedValue(undefined);
});

describe("POST /api/events — organizer 'going' seeding", () => {
  it("seeds the host as 'going' when creating a trip", async () => {
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events").send({
      title: "Lake weekend",
      type: "trip",
      squadId: "squad-1",
      startAt: "2026-07-01T09:00:00.000Z",
      endAt: "2026-07-03T18:00:00.000Z",
    });

    expect(res.status).toBe(201);
    expect(dbState.capturedInsert?.rsvps).toEqual({ [HOST]: "going" });
  });

  it("does NOT seed the host for a plain event (host RSVPs themselves)", async () => {
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events").send({
      title: "BBQ",
      type: "event",
      squadId: "squad-1",
      date: "TBD",
    });

    expect(res.status).toBe(201);
    expect(dbState.capturedInsert?.rsvps).toBeUndefined();
  });
});
