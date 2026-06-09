import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const dbState = vi.hoisted(() => ({
  selectRows: [] as unknown[],
  insertRows: [] as unknown[],
  updateRows: [] as unknown[],
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
      values: () => ({ returning: () => Promise.resolve(dbState.insertRows) }),
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve(dbState.updateRows) }) }),
    }),
    delete: () => ({ where: () => Promise.resolve() }),
  },
  eventsTable: { id: "id", hostId: "host_id", rsvps: "rsvps", createdAt: "created_at", inviteCode: "invite_code" },
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

const sendPushNotificationsMock = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: sendPushNotificationsMock }));

import eventsRouter from "../routes/events";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";

const makeApp = (user?: TestUser) => makeTestApp(eventsRouter, user);

const HOST = "host-id";
const ALICE = "alice-id";
const BOB = "bob-id";

beforeEach(() => {
  vi.clearAllMocks();
  dbState.selectRows = [];
  dbState.insertRows = [];
  dbState.updateRows = [];
  storageMock.getUser.mockResolvedValue({ id: HOST, firstName: "Hank", lastName: null, email: "h@x.io" });
  storageMock.upsertUser.mockResolvedValue({ id: HOST });
  storageMock.getSubscription.mockResolvedValue(null);
  storageMock.getActiveSubscriptionByCustomerId.mockResolvedValue(null);
  storageMock.countUserEventsThisYear.mockResolvedValue(0);
  storageMock.getSquad.mockResolvedValue({ id: "squad-1", name: "Crew", memberIds: [HOST, ALICE, BOB] });
  storageMock.filterUnmutedForSquad.mockImplementation(async (ids: string[]) => ids);
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.clearPushToken.mockResolvedValue(undefined);
  sendPushNotificationsMock.mockResolvedValue({ staleTokens: [] });
});

describe("POST /api/events — squad event invite push", () => {
  it("invites the squad (minus host), respecting mute + Event Invites pref", async () => {
    dbState.insertRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", squadId: "squad-1", hostId: HOST }];
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]"]);

    const app = await makeApp({ id: HOST });
    await request(app).post("/api/events").send({ title: "BBQ", emoji: "🔥", date: "TBD", squadId: "squad-1" });

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    expect(storageMock.filterUnmutedForSquad).toHaveBeenCalledWith(expect.arrayContaining([ALICE, BOB]), "squad-1");
    const [recipientIds, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], { requireNotifyEventInvites?: boolean }];
    expect(recipientIds).not.toContain(HOST);
    expect(opts.requireNotifyEventInvites).toBe(true);
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { data: Record<string, string> }];
    expect(payload.data.screen).toBe("event");
    expect(payload.data.eventId).toBe("evt-1");
  });

  it("does NOT push for a personal (no-squad) event", async () => {
    dbState.insertRows = [{ id: "evt-2", title: "Solo", emoji: "🎉", squadId: "", hostId: HOST }];

    const app = await makeApp({ id: HOST });
    await request(app).post("/api/events").send({ title: "Solo", emoji: "🎉", date: "TBD", squadId: "" });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/events/:id — best-time-locked push", () => {
  it("notifies RSVP'd attendees (minus host) when a concrete date is set", async () => {
    dbState.selectRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, date: "TBD", rsvps: { [ALICE]: "going", [BOB]: "maybe" } }];
    dbState.updateRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, date: "Sat, Jun 7 · 5:00 PM", rsvps: { [ALICE]: "going", [BOB]: "maybe" } }];
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]"]);

    const app = await makeApp({ id: HOST });
    await request(app).patch("/api/events/evt-1").send({ date: "Sat, Jun 7 · 5:00 PM" });

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    const [recipientIds, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], { requireNotifyEventInvites?: boolean }];
    expect(recipientIds).toContain(ALICE);
    expect(recipientIds).toContain(BOB);
    expect(recipientIds).not.toContain(HOST);
    expect(opts.requireNotifyEventInvites).toBe(true);
  });

  it("does NOT push when the date is unchanged", async () => {
    dbState.selectRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, date: "Sat, Jun 7 · 5:00 PM", rsvps: { [ALICE]: "going" } }];
    dbState.updateRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, date: "Sat, Jun 7 · 5:00 PM", rsvps: { [ALICE]: "going" } }];

    const app = await makeApp({ id: HOST });
    await request(app).patch("/api/events/evt-1").send({ date: "Sat, Jun 7 · 5:00 PM" });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });

  it("does NOT push when the date is cleared to TBD", async () => {
    dbState.selectRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, date: "Sat, Jun 7 · 5:00 PM", rsvps: { [ALICE]: "going" } }];
    dbState.updateRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, date: "TBD", rsvps: { [ALICE]: "going" } }];

    const app = await makeApp({ id: HOST });
    await request(app).patch("/api/events/evt-1").send({ date: "TBD" });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/events/:id/rsvp — host notification", () => {
  it("notifies the host with the Friend Activity pref when a member RSVPs", async () => {
    dbState.selectRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, date: "TBD", rsvps: { [ALICE]: "maybe" } }];
    dbState.updateRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, date: "TBD", rsvps: { [ALICE]: "going" } }];
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[host]"]);
    storageMock.getUser.mockResolvedValue({ id: ALICE, firstName: "Alice", lastName: null, email: null });

    const app = await makeApp({ id: ALICE });
    await request(app).post("/api/events/evt-1/rsvp").send({ status: "going" });

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    const [recipientIds, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], { requireNotifyFriendActivity?: boolean }];
    expect(recipientIds).toEqual([HOST]);
    expect(opts.requireNotifyFriendActivity).toBe(true);
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string; data: Record<string, string> }];
    expect(payload.body).toContain("Alice");
    expect(payload.body).toContain("going");
    expect(payload.data.eventId).toBe("evt-1");
  });

  it("does NOT notify when the host RSVPs to their own event", async () => {
    dbState.selectRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, date: "TBD", rsvps: {} }];
    dbState.updateRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, date: "TBD", rsvps: { [HOST]: "going" } }];

    const app = await makeApp({ id: HOST });
    await request(app).post("/api/events/evt-1/rsvp").send({ status: "going" });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/events/join — host notification", () => {
  it("notifies the host with the Friend Activity pref when a member joins by invite code", async () => {
    dbState.selectRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, cancelled: false, inviteCode: "ABC123", rsvps: {} }];
    dbState.updateRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, rsvps: { [ALICE]: "going" } }];
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[host]"]);
    storageMock.getUser.mockResolvedValue({ id: ALICE, firstName: "Alice", lastName: null, email: null });

    const app = await makeApp({ id: ALICE });
    await request(app).post("/api/events/join").send({ inviteCode: "ABC123" });

    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    const [recipientIds, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], { requireNotifyFriendActivity?: boolean }];
    expect(recipientIds).toEqual([HOST]);
    expect(opts.requireNotifyFriendActivity).toBe(true);
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string; data: Record<string, string> }];
    expect(payload.body).toContain("Alice");
    expect(payload.body).toContain("going");
    expect(payload.data.screen).toBe("event");
    expect(payload.data.eventId).toBe("evt-1");
  });

  it("does NOT notify when the host joins their own event", async () => {
    dbState.selectRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, cancelled: false, inviteCode: "ABC123", rsvps: {} }];
    dbState.updateRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, rsvps: { [HOST]: "going" } }];

    const app = await makeApp({ id: HOST });
    await request(app).post("/api/events/join").send({ inviteCode: "ABC123" });

    await new Promise((r) => setTimeout(r, 50));
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });

  it("does NOT send when the host has the Friend Activity pref off (no token)", async () => {
    dbState.selectRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, cancelled: false, inviteCode: "ABC123", rsvps: {} }];
    dbState.updateRows = [{ id: "evt-1", title: "BBQ", emoji: "🔥", hostId: HOST, rsvps: { [ALICE]: "going" } }];
    storageMock.getPushTokensForUsers.mockResolvedValue([]);

    const app = await makeApp({ id: ALICE });
    await request(app).post("/api/events/join").send({ inviteCode: "ABC123" });

    await new Promise((r) => setTimeout(r, 50));
    const [, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], { requireNotifyFriendActivity?: boolean }];
    expect(opts.requireNotifyFriendActivity).toBe(true);
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });
});
