import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const dbState = vi.hoisted(() => ({
  selectRows: [] as unknown[],
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
  markManualReminderSent: vi.fn(),
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
const CAROL = "carol-id";

const FUTURE_EVENT_AT = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();

function makeEvent(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "evt-1",
    title: "BBQ",
    emoji: "🔥",
    date: "Fri, Jul 25 · 6:00 PM",
    eventAt: FUTURE_EVENT_AT,
    hostId: HOST,
    squadId: "squad-1",
    rsvps: { [ALICE]: "going", [BOB]: "maybe" },
    invitedUserIds: [],
    coAdminIds: [],
    cancelled: false,
    manualReminderGeneralSentAt: null,
    manualReminderRsvpSentAt: null,
    version: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.selectRows = [];
  dbState.updateRows = [];
  storageMock.getUser.mockResolvedValue({ id: HOST });
  storageMock.upsertUser.mockResolvedValue({ id: HOST });
  storageMock.getSubscription.mockResolvedValue(null);
  storageMock.getActiveSubscriptionByCustomerId.mockResolvedValue(null);
  storageMock.countUserEventsThisYear.mockResolvedValue(0);
  storageMock.getSquad.mockResolvedValue({ id: "squad-1", name: "Crew", memberIds: [HOST, ALICE, BOB, CAROL] });
  storageMock.filterUnmutedForSquad.mockImplementation(async (ids: string[]) => ids);
  storageMock.getPushTokensForUsers.mockResolvedValue([]);
  storageMock.markManualReminderSent.mockResolvedValue(undefined);
  storageMock.clearPushToken.mockResolvedValue(undefined);
  sendPushNotificationsMock.mockResolvedValue({ okCount: 1, hadSendError: false, staleTokens: [] });
});

describe("POST /api/events/:id/remind", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
    expect(res.status).toBe(401);
  });

  it("returns 404 when event not found", async () => {
    dbState.selectRows = [];
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
    expect(res.status).toBe(404);
  });

  it("returns 403 when caller is not the host or a co-admin", async () => {
    dbState.selectRows = [makeEvent({ hostId: "someone-else", coAdminIds: [] })];
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
    expect(res.status).toBe(403);
  });

  it("allows a co-admin (not host) to send a reminder", async () => {
    dbState.selectRows = [makeEvent({ hostId: "someone-else", coAdminIds: [HOST] })];
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]"]);
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 400 for an unknown type", async () => {
    dbState.selectRows = [makeEvent()];
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events/evt-1/remind").send({ type: "instant" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the event date is TBD (no parseable start)", async () => {
    dbState.selectRows = [makeEvent({ date: "TBD", eventAt: null })];
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
    expect(res.status).toBe(400);
  });

  describe("general type", () => {
    it("sends to going + maybe RSVPs, excluding the sender, respecting requireNotifyReminders", async () => {
      dbState.selectRows = [makeEvent({ rsvps: { [ALICE]: "going", [BOB]: "maybe", [HOST]: "going" } })];
      storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]", "ExponentPushToken[b]"]);
      const app = await makeApp({ id: HOST });
      await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
      await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
      const [recipientIds, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [
        string[],
        { requireNotifyReminders?: boolean },
      ];
      expect(recipientIds).toContain(ALICE);
      expect(recipientIds).toContain(BOB);
      expect(recipientIds).not.toContain(HOST);
      expect(opts.requireNotifyReminders).toBe(true);
    });

    it("excludes users with 'not going' from the general audience", async () => {
      dbState.selectRows = [makeEvent({ rsvps: { [ALICE]: "not going", [BOB]: "going" } })];
      storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[b]"]);
      const app = await makeApp({ id: HOST });
      await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
      await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
      const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[]];
      expect(recipientIds).not.toContain(ALICE);
      expect(recipientIds).toContain(BOB);
    });

    it("stamps general cooldown immediately and returns 200", async () => {
      dbState.selectRows = [makeEvent()];
      const app = await makeApp({ id: HOST });
      const res = await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(storageMock.markManualReminderSent).toHaveBeenCalledWith("evt-1", "general");
    });

    it("applies squad mute filter to general audience", async () => {
      dbState.selectRows = [makeEvent({ rsvps: { [ALICE]: "going", [BOB]: "going" } })];
      storageMock.filterUnmutedForSquad.mockResolvedValue([ALICE]);
      storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]"]);
      const app = await makeApp({ id: HOST });
      await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
      await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
      const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[]];
      expect(recipientIds).toEqual([ALICE]);
    });

    it("returns 429 with retryAfterMs when general cooldown is active", async () => {
      const recentlySent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      dbState.selectRows = [makeEvent({ manualReminderGeneralSentAt: recentlySent })];
      const app = await makeApp({ id: HOST });
      const res = await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
      expect(res.status).toBe(429);
      expect(res.body.retryAfterMs).toBeGreaterThan(0);
      expect(res.body.retryAfterMs).toBeLessThanOrEqual(50 * 60 * 1000 + 1000);
    });

    it("rsvp cooldown does NOT block general", async () => {
      const recentlySent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      dbState.selectRows = [makeEvent({ manualReminderRsvpSentAt: recentlySent })];
      const app = await makeApp({ id: HOST });
      const res = await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
      expect(res.status).toBe(200);
    });

    it("allows sending after the 1-hour cooldown has elapsed", async () => {
      const expiredSentAt = new Date(Date.now() - 61 * 60 * 1000).toISOString();
      dbState.selectRows = [makeEvent({ manualReminderGeneralSentAt: expiredSentAt })];
      const app = await makeApp({ id: HOST });
      const res = await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
      expect(res.status).toBe(200);
    });
  });

  describe("rsvp type", () => {
    it("sends to squad members who have not responded, excluding sender and respondents", async () => {
      dbState.selectRows = [makeEvent({ rsvps: { [ALICE]: "going" }, invitedUserIds: [] })];
      storageMock.getSquad.mockResolvedValue({ id: "squad-1", memberIds: [HOST, ALICE, BOB, CAROL] });
      storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[b]", "ExponentPushToken[c]"]);
      const app = await makeApp({ id: HOST });
      await request(app).post("/api/events/evt-1/remind").send({ type: "rsvp" });
      await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
      const [recipientIds, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [
        string[],
        { requireNotifyReminders?: boolean },
      ];
      expect(recipientIds).not.toContain(HOST);
      expect(recipientIds).not.toContain(ALICE);
      expect(recipientIds).toContain(BOB);
      expect(recipientIds).toContain(CAROL);
      expect(opts.requireNotifyReminders).toBe(true);
    });

    it("includes directly invited friends who have not responded", async () => {
      const FRIEND = "friend-id";
      dbState.selectRows = [makeEvent({ rsvps: {}, invitedUserIds: [FRIEND], squadId: "" })];
      storageMock.getSquad.mockResolvedValue(null);
      storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[f]"]);
      const app = await makeApp({ id: HOST });
      await request(app).post("/api/events/evt-1/remind").send({ type: "rsvp" });
      await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
      const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[]];
      expect(recipientIds).toContain(FRIEND);
    });

    it("stamps only the rsvp cooldown (not general)", async () => {
      dbState.selectRows = [makeEvent()];
      const app = await makeApp({ id: HOST });
      await request(app).post("/api/events/evt-1/remind").send({ type: "rsvp" });
      expect(storageMock.markManualReminderSent).toHaveBeenCalledWith("evt-1", "rsvp");
      expect(storageMock.markManualReminderSent).not.toHaveBeenCalledWith("evt-1", "general");
    });

    it("returns 429 with retryAfterMs when rsvp cooldown is active", async () => {
      const recentlySent = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      dbState.selectRows = [makeEvent({ manualReminderRsvpSentAt: recentlySent })];
      const app = await makeApp({ id: HOST });
      const res = await request(app).post("/api/events/evt-1/remind").send({ type: "rsvp" });
      expect(res.status).toBe(429);
      expect(res.body.retryAfterMs).toBeGreaterThan(0);
    });

    it("general cooldown does NOT block rsvp", async () => {
      const recentlySent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      dbState.selectRows = [makeEvent({ manualReminderGeneralSentAt: recentlySent })];
      const app = await makeApp({ id: HOST });
      const res = await request(app).post("/api/events/evt-1/remind").send({ type: "rsvp" });
      expect(res.status).toBe(200);
    });
  });

  it("push body includes a relative date label (tomorrow, in N days, etc.)", async () => {
    const tomorrowAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    dbState.selectRows = [makeEvent({ eventAt: tomorrowAt, rsvps: { [ALICE]: "going" } })];
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]"]);
    const app = await makeApp({ id: HOST });
    await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).toContain("tomorrow");
  });
});
