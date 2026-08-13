import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const dbState = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  insertRows: [] as unknown[],
  updateRows: [] as unknown[],
  capturedInsert: undefined as Record<string, unknown> | undefined,
  capturedUpdate: undefined as Record<string, unknown> | undefined,
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
      values: (values: Record<string, unknown>) => {
        if ("hostId" in values) dbState.capturedInsert = values;
        return { returning: () => Promise.resolve(dbState.insertRows) };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        dbState.capturedUpdate = values;
        return {
          where: () => ({
            returning: () => Promise.resolve(dbState.updateRows),
          }),
        };
      },
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  },
  eventsTable: {
    id: "id",
    hostId: "host_id",
    squadId: "squad_id",
    version: "version",
    rsvps: "rsvps",
    invitedUserIds: "invited_user_ids",
    createdAt: "created_at",
    inviteCode: "invite_code",
  },
  eventCreationsTable: { userId: "user_id", eventId: "event_id", source: "source" },
  usersTable: {},
  eventInvitesTable: {},
  activityTable: {},
  availabilityPollsTable: {},
}));

const storageMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  upsertUser: vi.fn(),
  getSubscription: vi.fn(),
  getActiveSubscriptionByCustomerId: vi.fn(),
  getSquad: vi.fn(),
  getFriendIds: vi.fn(),
  countUserEventsThisYear: vi.fn(),
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
import { makeTestApp } from "./helpers/makeTestApp";

const HOST = "host-id";
const makeApp = () => makeTestApp(eventsRouter, { id: HOST });

const existingEvent = {
  id: "evt-1",
  title: "Dinner",
  type: "event",
  emoji: "🎉",
  date: "TBD",
  location: "Somewhere",
  squadId: "",
  squadName: "Personal",
  hostId: HOST,
  description: "",
  inviteCode: "SQ-ABCD",
  cancelled: false,
  rsvps: {},
  invitedUserIds: [],
  tasks: [],
  costs: [],
  polls: [],
  messages: [],
  version: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  dbState.selectRows = [];
  dbState.insertRows = [{ id: "evt-created", hostId: HOST, version: 0 }];
  dbState.updateRows = [];
  dbState.capturedInsert = undefined;
  dbState.capturedUpdate = undefined;

  storageMock.getUser.mockResolvedValue({ id: HOST, email: "host@example.com" });
  storageMock.upsertUser.mockResolvedValue({ id: HOST });
  storageMock.getSubscription.mockResolvedValue(null);
  storageMock.getActiveSubscriptionByCustomerId.mockResolvedValue(null);
  storageMock.getSquad.mockResolvedValue(null);
  storageMock.getFriendIds.mockResolvedValue([]);
  storageMock.countUserEventsThisYear.mockResolvedValue(0);
  storageMock.filterUnmutedForSquad.mockImplementation(async (ids: string[]) => ids);
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.clearPushToken.mockResolvedValue(undefined);
});

describe("POST /api/events — squad attachment authorization", () => {
  it("returns 403 when creating in a squad the host is not a member of", async () => {
    storageMock.getSquad.mockResolvedValue({
      id: "foreign-squad",
      name: "Someone Else's Squad",
      memberIds: ["another-user"],
    });

    const res = await request(makeApp()).post("/api/events").send({
      title: "Unauthorized plan",
      squadId: "foreign-squad",
      squadName: "Spoofed name",
    });

    expect(res.status).toBe(403);
    expect(dbState.capturedInsert).toBeUndefined();
  });

  it("returns 404 when creating with a nonexistent squad id", async () => {
    const res = await request(makeApp()).post("/api/events").send({
      title: "Dangling plan",
      squadId: "missing-squad",
    });

    expect(res.status).toBe(404);
    expect(dbState.capturedInsert).toBeUndefined();
  });

  it("persists the squad name from the record, not client input", async () => {
    storageMock.getSquad.mockResolvedValue({
      id: "home-squad",
      name: "Actual Squad Name",
      memberIds: [HOST],
    });

    const res = await request(makeApp()).post("/api/events").send({
      title: "Authorized plan",
      squadId: "home-squad",
      squadName: "Client-controlled name",
    });

    expect(res.status).toBe(201);
    expect(dbState.capturedInsert?.squadId).toBe("home-squad");
    expect(dbState.capturedInsert?.squadName).toBe("Actual Squad Name");
  });
});

describe("PATCH /api/events/:id — squad reassignment authorization", () => {
  beforeEach(() => {
    dbState.selectRows = [existingEvent];
  });

  it("returns 403 when moving a plan to a squad the host is not in", async () => {
    storageMock.getSquad.mockResolvedValue({
      id: "foreign-squad",
      name: "Someone Else's Squad",
      memberIds: ["another-user"],
    });

    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({ squadId: "foreign-squad", version: 4 });

    expect(res.status).toBe(403);
    expect(dbState.capturedUpdate).toBeUndefined();
  });

  it("returns 404 when moving a plan to a nonexistent squad", async () => {
    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({ squadId: "missing-squad", version: 4 });

    expect(res.status).toBe(404);
    expect(dbState.capturedUpdate).toBeUndefined();
  });

  it("uses the target squad record for the reassigned plan name", async () => {
    const updatedEvent = {
      ...existingEvent,
      squadId: "home-squad",
      squadName: "Actual Squad Name",
      version: 5,
    };
    storageMock.getSquad.mockResolvedValue({
      id: "home-squad",
      name: "Actual Squad Name",
      memberIds: [HOST],
    });
    dbState.updateRows = [updatedEvent];

    const res = await request(makeApp())
      .patch("/api/events/evt-1")
      .send({
        squadId: "home-squad",
        squadName: "Client-controlled name",
        version: 4,
      });

    expect(res.status).toBe(200);
    expect(dbState.capturedUpdate?.squadId).toBe("home-squad");
    expect(dbState.capturedUpdate?.squadName).toBe("Actual Squad Name");
    expect(res.body.squadName).toBe("Actual Squad Name");
  });
});