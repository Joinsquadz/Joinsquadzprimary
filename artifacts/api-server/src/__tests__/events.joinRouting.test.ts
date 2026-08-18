/**
 * Accepting an invite must tell the client WHICH screen to open.
 *
 * Trips live in the same `events` table as ordinary events but render on their
 * own detail route. The join responses (both the fresh 200 and the "you're
 * already going" 409, which the invite screen treats as a terminal success)
 * therefore have to carry the plan id AND its type — otherwise the client can
 * only guess, and a trip invite opens the event page until the user navigates
 * away and back.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const dbState = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  updateRows: [] as unknown[],
}));

vi.mock("@workspace/db", () => {
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
    values: () => ({
      returning: () => Promise.resolve([]),
      onConflictDoNothing: () => Promise.resolve(undefined),
    }),
  });

  const update = () => ({
    set: () => ({
      where: () => ({ returning: () => Promise.resolve(dbState.updateRows) }),
    }),
  });

  return {
    db: {
      select: () => chain(dbState.selectRows),
      insert,
      update,
      delete: () => ({ where: () => Promise.resolve() }),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        let selectN = 0;
        const tx = {
          execute: vi.fn().mockResolvedValue({ rows: [] }),
          select: () => {
            selectN++;
            // 1st: "already claimed?" probe. 2nd: the rolling-window count.
            if (selectN === 1) return chain([]);
            if (selectN === 2) return chain([{ count: 0 }]);
            return chain([]);
          },
          insert,
          update,
          delete: () => ({ where: () => Promise.resolve() }),
        };
        return fn(tx);
      }),
    },
    eventsTable: {
      id: "id",
      hostId: "host_id",
      rsvps: "rsvps",
      version: "version",
      createdAt: "created_at",
      inviteCode: "invite_code",
    },
    eventCreationsTable: { userId: "user_id", eventId: "event_id", createdAt: "created_at" },
    usersTable: {},
  };
});

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
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: vi.fn() }));

import eventsRouter from "../routes/events";
import { makeTestApp } from "./helpers/makeTestApp";

const HOST = "host-id";
const ALICE = "alice-id";

const makeApp = () => makeTestApp(eventsRouter, { id: ALICE });

beforeEach(() => {
  vi.clearAllMocks();
  dbState.selectRows = [];
  dbState.updateRows = [];
  storageMock.getUser.mockResolvedValue({ id: ALICE, firstName: "Alice", lastName: null, email: null });
  storageMock.upsertUser.mockResolvedValue({ id: ALICE });
  storageMock.getSubscription.mockResolvedValue(null);
  storageMock.getActiveSubscriptionByCustomerId.mockResolvedValue(null);
  storageMock.countUserEventsThisYear.mockResolvedValue(0);
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.clearPushToken.mockResolvedValue(undefined);
});

describe("POST /api/events/join — routing information", () => {
  it("returns the trip row (with its type) on a fresh join", async () => {
    const trip = {
      id: "trip-1",
      type: "trip",
      title: "Vegas",
      emoji: "🎰",
      hostId: HOST,
      cancelled: false,
      inviteCode: "CODE1",
      rsvps: {},
    };
    dbState.selectRows = [trip];
    dbState.updateRows = [{ ...trip, rsvps: { [ALICE]: "going" } }];

    const res = await request(makeApp()).post("/api/events/join").send({ inviteCode: "CODE1" });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("trip-1");
    expect(res.body.type).toBe("trip");
  });

  it("includes the id and plan type on the already-going 409", async () => {
    // The client treats 409 as success and opens the plan, so the response has
    // to say which plan and which screen.
    dbState.selectRows = [
      {
        id: "trip-1",
        type: "trip",
        title: "Vegas",
        emoji: "🎰",
        hostId: HOST,
        cancelled: false,
        inviteCode: "CODE1",
        rsvps: { [ALICE]: "going" },
      },
    ];

    const res = await request(makeApp()).post("/api/events/join").send({ inviteCode: "CODE1" });

    expect(res.status).toBe(409);
    expect(res.body.id).toBe("trip-1");
    expect(res.body.type).toBe("trip");
  });

  it("reports a legacy typeless row as an event on the 409", async () => {
    dbState.selectRows = [
      {
        id: "evt-9",
        title: "BBQ",
        emoji: "🔥",
        hostId: HOST,
        cancelled: false,
        inviteCode: "CODE1",
        rsvps: { [ALICE]: "going" },
      },
    ];

    const res = await request(makeApp()).post("/api/events/join").send({ inviteCode: "CODE1" });

    expect(res.status).toBe(409);
    expect(res.body.id).toBe("evt-9");
    expect(res.body.type).toBe("event");
  });
});
