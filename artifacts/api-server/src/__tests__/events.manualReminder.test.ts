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
  getPushRecipientsForUsers: vi.fn(),
  markManualReminderSent: vi.fn(),
  markManualReminderSentAtomic: vi.fn(),
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
  storageMock.getPushRecipientsForUsers.mockResolvedValue([]);
  storageMock.markManualReminderSent.mockResolvedValue(undefined);
  // BUG-03: default to "won the race" so happy-path tests proceed normally.
  storageMock.markManualReminderSentAtomic.mockResolvedValue({ won: true });
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
    storageMock.getPushRecipientsForUsers.mockResolvedValue([{ pushToken: "ExponentPushToken[a]", timezone: null }]);
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
      storageMock.getPushRecipientsForUsers.mockResolvedValue([{ pushToken: "ExponentPushToken[a]", timezone: null }, { pushToken: "ExponentPushToken[b]", timezone: null }]);
      const app = await makeApp({ id: HOST });
      await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
      await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
      const [recipientIds, opts] = storageMock.getPushRecipientsForUsers.mock.calls[0] as [
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
      storageMock.getPushRecipientsForUsers.mockResolvedValue([{ pushToken: "ExponentPushToken[b]", timezone: null }]);
      const app = await makeApp({ id: HOST });
      await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
      await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
      const [recipientIds] = storageMock.getPushRecipientsForUsers.mock.calls[0] as [string[]];
      expect(recipientIds).not.toContain(ALICE);
      expect(recipientIds).toContain(BOB);
    });

    it("stamps general cooldown atomically and returns 200", async () => {
      dbState.selectRows = [makeEvent()];
      const app = await makeApp({ id: HOST });
      const res = await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      // BUG-03: uses atomic check-and-set, not separate read + write.
      expect(storageMock.markManualReminderSentAtomic).toHaveBeenCalledWith(
        "evt-1",
        "general",
        expect.any(Number),
      );
    });

    it("applies squad mute filter to general audience", async () => {
      dbState.selectRows = [makeEvent({ rsvps: { [ALICE]: "going", [BOB]: "going" } })];
      storageMock.filterUnmutedForSquad.mockResolvedValue([ALICE]);
      storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]"]);
      storageMock.getPushRecipientsForUsers.mockResolvedValue([{ pushToken: "ExponentPushToken[a]", timezone: null }]);
      const app = await makeApp({ id: HOST });
      await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
      await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
      const [recipientIds] = storageMock.getPushRecipientsForUsers.mock.calls[0] as [string[]];
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
      storageMock.getPushRecipientsForUsers.mockResolvedValue([{ pushToken: "ExponentPushToken[b]", timezone: null }, { pushToken: "ExponentPushToken[c]", timezone: null }]);
      const app = await makeApp({ id: HOST });
      await request(app).post("/api/events/evt-1/remind").send({ type: "rsvp" });
      await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
      const [recipientIds, opts] = storageMock.getPushRecipientsForUsers.mock.calls[0] as [
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
      storageMock.getPushRecipientsForUsers.mockResolvedValue([{ pushToken: "ExponentPushToken[f]", timezone: null }]);
      const app = await makeApp({ id: HOST });
      await request(app).post("/api/events/evt-1/remind").send({ type: "rsvp" });
      await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
      const [recipientIds] = storageMock.getPushRecipientsForUsers.mock.calls[0] as [string[]];
      expect(recipientIds).toContain(FRIEND);
    });

    it("stamps only the rsvp cooldown (not general)", async () => {
      dbState.selectRows = [makeEvent()];
      const app = await makeApp({ id: HOST });
      await request(app).post("/api/events/evt-1/remind").send({ type: "rsvp" });
      // BUG-03: uses atomic stamp.
      expect(storageMock.markManualReminderSentAtomic).toHaveBeenCalledWith(
        "evt-1",
        "rsvp",
        expect.any(Number),
      );
      expect(storageMock.markManualReminderSentAtomic).not.toHaveBeenCalledWith(
        "evt-1",
        "general",
        expect.any(Number),
      );
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

  // ── BUG-03: atomic cooldown ────────────────────────────────────────────────
  it("BUG-03: returns 429 when concurrent call already stamped the cooldown", async () => {
    dbState.selectRows = [makeEvent({ rsvps: { [ALICE]: "going" } })];
    // Simulate: another caller's atomic stamp already won the race.
    storageMock.markManualReminderSentAtomic.mockResolvedValue({ won: false, retryAfterMs: 2_400_000 });
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
    expect(res.status).toBe(429);
    expect(res.body.retryAfterMs).toBe(2_400_000);
  });

  // ── BUG-06: no cooldown stamp on zero audience ─────────────────────────────
  it("BUG-06: returns {ok,allResponded} without stamping when everyone already responded", async () => {
    // All squad members have RSVPs → rsvp audience is empty.
    dbState.selectRows = [makeEvent({ rsvps: { [ALICE]: "going", [BOB]: "going", [CAROL]: "going" }, invitedUserIds: [] })];
    storageMock.getSquad.mockResolvedValue({ id: "squad-1", memberIds: [HOST, ALICE, BOB, CAROL] });
    const app = await makeApp({ id: HOST });
    const res = await request(app).post("/api/events/evt-1/remind").send({ type: "rsvp" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.allResponded).toBe(true);
    // Cooldown timer must NOT be consumed on a zero-audience call.
    expect(storageMock.markManualReminderSentAtomic).not.toHaveBeenCalled();
  });

  // ── BUG-10: host and co-admins excluded from rsvp audience ────────────────
  it("BUG-10: rsvp type excludes host AND co-admins even if they have no RSVP row", async () => {
    const CO_ADMIN = "co-admin-id";
    // HOST is acting as a co-admin; "some-host" is the actual host.
    dbState.selectRows = [makeEvent({
      hostId: "some-host",
      coAdminIds: [HOST, CO_ADMIN],
      rsvps: {},           // nobody has responded yet
      invitedUserIds: [],
    })];
    storageMock.getSquad.mockResolvedValue({
      id: "squad-1",
      memberIds: ["some-host", HOST, CO_ADMIN, ALICE, BOB],
    });
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]"]);
    storageMock.getPushRecipientsForUsers.mockResolvedValue([{ pushToken: "ExponentPushToken[a]", timezone: null }]);
    const app = await makeApp({ id: HOST });
    await request(app).post("/api/events/evt-1/remind").send({ type: "rsvp" });
    await vi.waitFor(() => expect(storageMock.markManualReminderSentAtomic).toHaveBeenCalled());
    const [recipientIds] = storageMock.getPushRecipientsForUsers.mock.calls[0] as [string[]];
    expect(recipientIds).not.toContain("some-host"); // host excluded
    expect(recipientIds).not.toContain(HOST);        // sender+co-admin excluded
    expect(recipientIds).not.toContain(CO_ADMIN);    // co-admin excluded
    expect(recipientIds).toContain(ALICE);           // regular member included
    expect(recipientIds).toContain(BOB);             // regular member included
  });

  it("push body includes a relative date label (tomorrow, in N days, etc.)", async () => {
    const tomorrowAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    dbState.selectRows = [
      makeEvent({ eventAt: tomorrowAt, timezone: "UTC", rsvps: { [ALICE]: "going" } }),
    ];
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]"]);
    storageMock.getPushRecipientsForUsers.mockResolvedValue([{ pushToken: "ExponentPushToken[a]", timezone: null }]);
    const app = await makeApp({ id: HOST });
    await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).toContain("tomorrow");
  });

  it("writes one push per recipient timezone, each on that reader's clock", async () => {
    // 11h out: 6:00 PM Jul 15 in LA is 10:00 AM Jul 16 in Tokyo — same instant,
    // different calendar day, so a single shared body can't be right for both.
    vi.useFakeTimers({ now: new Date("2026-07-15T14:00:00Z") });
    dbState.selectRows = [
      makeEvent({
        eventAt: "2026-07-16T01:00:00.000Z",
        timezone: "America/Los_Angeles",
        rsvps: { [ALICE]: "going", [BOB]: "going" },
      }),
    ];
    storageMock.getPushRecipientsForUsers.mockResolvedValue([
      { pushToken: "ExponentPushToken[la]", timezone: "America/Los_Angeles" },
      { pushToken: "ExponentPushToken[tokyo]", timezone: "Asia/Tokyo" },
    ]);
    const app = await makeApp({ id: HOST });
    await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalledTimes(2));
    vi.useRealTimers();

    const calls = sendPushNotificationsMock.mock.calls as Array<[string[], { body: string }]>;
    expect(calls[0][0]).toEqual(["ExponentPushToken[la]"]);
    expect(calls[0][1].body).toContain("today");
    expect(calls[1][0]).toEqual(["ExponentPushToken[tokyo]"]);
    expect(calls[1][1].body).toContain("tomorrow");
  });

  it("prints the reader's local clock time when the day label doesn't apply", async () => {
    // Four days out — too far for today/tomorrow, so the body should carry an
    // explicit local time rather than the creator's stored date text.
    dbState.selectRows = [
      makeEvent({
        eventAt: "2026-07-19T01:00:00.000Z",
        date: "Wed, Jul 15 · 6:00 PM",
        timezone: "America/Los_Angeles",
        rsvps: { [ALICE]: "going" },
      }),
    ];
    storageMock.getPushRecipientsForUsers.mockResolvedValue([
      { pushToken: "ExponentPushToken[tokyo]", timezone: "Asia/Tokyo" },
    ]);
    const app = await makeApp({ id: HOST });
    await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).toContain("Sun, Jul 19 · 10:00 AM");
    // The creator's stored text must NOT leak into a reader in another zone.
    expect(payload.body).not.toContain("Wed, Jul 15 · 6:00 PM");
  });

  it("falls back to the event's date text when the event has no stored timezone", async () => {
    // Without a timezone the server used to compare calendar days in UTC, which
    // labels any evening event in a behind-UTC zone as "tomorrow" even when the
    // date printed beside it says today. Prefer the unambiguous date text.
    const tomorrowAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    dbState.selectRows = [
      makeEvent({
        eventAt: tomorrowAt,
        timezone: null,
        date: "Fri, Jul 25 · 6:00 PM",
        rsvps: { [ALICE]: "going" },
      }),
    ];
    storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[a]"]);
    storageMock.getPushRecipientsForUsers.mockResolvedValue([{ pushToken: "ExponentPushToken[a]", timezone: null }]);
    const app = await makeApp({ id: HOST });
    await request(app).post("/api/events/evt-1/remind").send({ type: "general" });
    await vi.waitFor(() => expect(sendPushNotificationsMock).toHaveBeenCalled());
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).not.toContain("tomorrow");
    expect(payload.body).toContain("Fri, Jul 25 · 6:00 PM");
  });
});
