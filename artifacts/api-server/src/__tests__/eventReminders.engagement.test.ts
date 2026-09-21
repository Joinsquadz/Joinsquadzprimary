import { describe, it, expect, vi, beforeEach } from "vitest";

const storageMock = vi.hoisted(() => ({
  getEventsPending3DayReminder: vi.fn(),
  markEvent3DayReminderSent: vi.fn(),        // retirement only
  tryClaimEvent3DayReminderSend: vi.fn(),
  unclaimEvent3DayReminderSend: vi.fn(),
  getEventsPendingRecap: vi.fn(),
  markEventRecapSent: vi.fn(),               // retirement only
  tryClaimEventRecapSend: vi.fn(),
  unclaimEventRecapSend: vi.fn(),
  getPollsPendingNudge: vi.fn(),
  markPollNudgeSent: vi.fn(),                // retirement only
  tryClaimPollNudgeSend: vi.fn(),
  unclaimPollNudgeSend: vi.fn(),
  getAvailabilityPollRoster: vi.fn(),
  getAvailabilityResponses: vi.fn(),
  getPushTokensForUsers: vi.fn(),
  getPushRecipientsForUsers: vi.fn(),
  filterUnmutedForSquad: vi.fn(),
  clearPushToken: vi.fn(),
  enqueuePushRetries: vi.fn(),
  getDuePushRetries: vi.fn(),
  deletePushRetries: vi.fn(),
  reschedulePushRetry: vi.fn(),
}));

const sendPushNotificationsMock = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: sendPushNotificationsMock }));

import {
  run3DayReminderScan,
  runEventRecapScan,
  runPollNudgeScan,
  groupRecipientsByZone,
  REMINDER_LEAD_MS,
  MIN_PLAN_AGE_FOR_3DAY_MS,
  RECAP_DELAY_MS,
  RECAP_MAX_AGE_MS,
  POLL_NUDGE_MIN_AGE_MS,
  POLL_NUDGE_MAX_AGE_MS,
  runPushRetryDrain,
  PUSH_RETRY_MAX_ATTEMPTS,
} from "../lib/eventReminders";

const GOING = "going-user";
const MAYBE = "maybe-user";

// A date string the parser understands, offset from "now" by msFromNow.
function dateStr(msFromNow: number): string {
  const d = new Date(Date.now() + msFromNow);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${weekday}, ${month} ${d.getDate()} · ${h}:${min} ${ampm}`;
}

function evt(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "evt-1",
    title: "BBQ",
    emoji: "🔥",
    date: dateStr(0),
    squadId: "",
    hostId: "host",
    rsvps: { [GOING]: "going", [MAYBE]: "maybe" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.filterUnmutedForSquad.mockImplementation(async (ids: string[]) => ids);
  storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[x]"]);
  storageMock.getPushRecipientsForUsers.mockResolvedValue([{ pushToken: "ExponentPushToken[x]", timezone: null }]);
  storageMock.markEvent3DayReminderSent.mockResolvedValue(undefined);
  storageMock.tryClaimEvent3DayReminderSend.mockResolvedValue(true);
  storageMock.unclaimEvent3DayReminderSend.mockResolvedValue(undefined);
  storageMock.markEventRecapSent.mockResolvedValue(undefined);
  storageMock.tryClaimEventRecapSend.mockResolvedValue(true);
  storageMock.unclaimEventRecapSend.mockResolvedValue(undefined);
  storageMock.markPollNudgeSent.mockResolvedValue(undefined);
  storageMock.tryClaimPollNudgeSend.mockResolvedValue(true);
  storageMock.unclaimPollNudgeSend.mockResolvedValue(undefined);
  storageMock.clearPushToken.mockResolvedValue(undefined);
  storageMock.enqueuePushRetries.mockResolvedValue(undefined);
  storageMock.getDuePushRetries.mockResolvedValue([]);
  storageMock.deletePushRetries.mockResolvedValue(undefined);
  storageMock.reschedulePushRetry.mockResolvedValue(undefined);
  sendPushNotificationsMock.mockResolvedValue({ staleTokens: [], okCount: 1, hadSendError: false });
});

describe("groupRecipientsByZone", () => {
  it("keeps one device token even when duplicate rows disagree on timezone", () => {
    expect(
      groupRecipientsByZone(
        [
          { pushToken: "ExponentPushToken[same]", timezone: "America/Los_Angeles" },
          { pushToken: "ExponentPushToken[same]", timezone: "Asia/Tokyo" },
          { pushToken: "ExponentPushToken[other]", timezone: "Asia/Tokyo" },
        ],
        null,
      ),
    ).toEqual([
      { timezone: "America/Los_Angeles", tokens: ["ExponentPushToken[same]"] },
      { timezone: "Asia/Tokyo", tokens: ["ExponentPushToken[other]"] },
    ]);
  });
});

describe("runPushRetryDrain", () => {
  const owedRow = (over: Record<string, unknown> = {}) => ({
    id: "retry-1",
    dedupeKey: "day-of-reminder:evt-1",
    pushToken: "ExponentPushToken[bad]",
    payload: { title: "t", body: "b", data: { screen: "event", eventId: "evt-1" } },
    attempts: 0,
    ...over,
  });

  it("re-sends only the owed device and clears the debt once it lands", async () => {
    storageMock.getDuePushRetries.mockResolvedValue([owedRow()]);
    sendPushNotificationsMock.mockResolvedValue({
      staleTokens: [], okCount: 1, hadSendError: false, failedTokens: [],
    });

    await runPushRetryDrain();

    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1);
    expect(sendPushNotificationsMock.mock.calls[0][0]).toEqual(["ExponentPushToken[bad]"]);
    expect(storageMock.deletePushRetries).toHaveBeenCalledWith(["retry-1"]);
    expect(storageMock.reschedulePushRetry).not.toHaveBeenCalled();
  });

  it("keeps owing the delivery and backs off when the retry also fails", async () => {
    storageMock.getDuePushRetries.mockResolvedValue([owedRow({ attempts: 1 })]);
    sendPushNotificationsMock.mockResolvedValue({
      staleTokens: [], okCount: 0, hadSendError: true, failedTokens: ["ExponentPushToken[bad]"],
    });

    await runPushRetryDrain();

    // Still owed — this is the case that previously lost the notification.
    expect(storageMock.deletePushRetries).not.toHaveBeenCalled();
    expect(storageMock.reschedulePushRetry).toHaveBeenCalledTimes(1);
    const [id, nextAttemptAt] = storageMock.reschedulePushRetry.mock.calls[0];
    expect(id).toBe("retry-1");
    expect(nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("stops owing a device that is no longer registered", async () => {
    storageMock.getDuePushRetries.mockResolvedValue([owedRow()]);
    sendPushNotificationsMock.mockResolvedValue({
      staleTokens: ["ExponentPushToken[bad]"], okCount: 0, hadSendError: false, failedTokens: [],
    });

    await runPushRetryDrain();

    expect(storageMock.deletePushRetries).toHaveBeenCalledWith(["retry-1"]);
    expect(storageMock.reschedulePushRetry).not.toHaveBeenCalled();
  });

  it("gives up rather than retrying forever once the ceiling is hit", async () => {
    storageMock.getDuePushRetries.mockResolvedValue([
      owedRow({ attempts: PUSH_RETRY_MAX_ATTEMPTS - 1 }),
    ]);
    sendPushNotificationsMock.mockResolvedValue({
      staleTokens: [], okCount: 0, hadSendError: true, failedTokens: ["ExponentPushToken[bad]"],
    });

    await runPushRetryDrain();

    expect(storageMock.deletePushRetries).toHaveBeenCalledWith(["retry-1"]);
    expect(storageMock.reschedulePushRetry).not.toHaveBeenCalled();
  });

  it("does nothing when no deliveries are owed", async () => {
    storageMock.getDuePushRetries.mockResolvedValue([]);

    await runPushRetryDrain();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.deletePushRetries).not.toHaveBeenCalled();
  });
});

describe("runEventRecapScan", () => {
  it("prompts 'going' RSVPs for photos a few hours after the event, then marks sent", async () => {
    storageMock.getEventsPendingRecap.mockResolvedValue([evt({ date: dateStr(-(RECAP_DELAY_MS + 60 * 60 * 1000)) })]);

    await runEventRecapScan();

    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { data: Record<string, string> }];
    expect(payload.data.screen).toBe("event");
    expect(payload.data.tab).toBe("photos");
    expect(storageMock.tryClaimEventRecapSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.markEventRecapSent).not.toHaveBeenCalled();
  });

  it("does NOT send (or mark) before the event is comfortably over", async () => {
    storageMock.getEventsPendingRecap.mockResolvedValue([evt({ date: dateStr(-(RECAP_DELAY_MS - 30 * 60 * 1000)) })]);

    await runEventRecapScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEventRecapSent).not.toHaveBeenCalled();
  });

  it.each([
    ["during the trip", 24 * 60 * 60 * 1000],
    ["just before the post-end delay", -(RECAP_DELAY_MS - 1)],
  ])("does NOT send a multi-day trip recap %s", async (_label, endOffsetMs) => {
    const now = new Date("2026-09-21T12:00:00.000Z");
    vi.useFakeTimers({ now });
    storageMock.getEventsPendingRecap.mockResolvedValue([
      evt({
        type: "trip",
        eventAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        endAt: new Date(now.getTime() + endOffsetMs),
      }),
    ]);

    await runEventRecapScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEventRecapSent).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("sends a multi-day trip recap at the three-hour post-end boundary", async () => {
    const now = new Date("2026-09-21T12:00:00.000Z");
    vi.useFakeTimers({ now });
    storageMock.getEventsPendingRecap.mockResolvedValue([
      evt({
        type: "trip",
        eventAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
        endAt: new Date(now.getTime() - RECAP_DELAY_MS),
      }),
    ]);

    await runEventRecapScan();

    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1);
    expect(storageMock.tryClaimEventRecapSend).toHaveBeenCalledWith("evt-1");
    vi.useRealTimers();
  });

  it("retires a multi-day trip after 48 hours measured from its end", async () => {
    const now = new Date("2026-09-21T12:00:00.000Z");
    vi.useFakeTimers({ now });
    storageMock.getEventsPendingRecap.mockResolvedValue([
      evt({
        type: "trip",
        eventAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        endAt: new Date(now.getTime() - RECAP_MAX_AGE_MS - 1),
      }),
    ]);

    await runEventRecapScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEventRecapSent).toHaveBeenCalledWith("evt-1");
    vi.useRealTimers();
  });

  it("retires very old events via eventAt even when the display date is the year-less app format", async () => {
    // Real-world shape: a stale event keeps its human-readable year-less display
    // string (which the parser would roll forward a year, hiding its true age),
    // but carries a machine-readable eventAt. Retirement must use eventAt.
    storageMock.getEventsPendingRecap.mockResolvedValue([
      evt({
        date: dateStr(8 * 60 * 60 * 1000), // misleading year-less string
        eventAt: new Date(Date.now() - (RECAP_MAX_AGE_MS + 60 * 60 * 1000)),
      }),
    ]);

    await runEventRecapScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEventRecapSent).toHaveBeenCalledWith("evt-1");
  });

  it("retires very old events parsed from an ISO display date (no eventAt fallback)", async () => {
    storageMock.getEventsPendingRecap.mockResolvedValue([
      evt({ date: new Date(Date.now() - (RECAP_MAX_AGE_MS + 60 * 60 * 1000)).toISOString() }),
    ]);

    await runEventRecapScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEventRecapSent).toHaveBeenCalledWith("evt-1");
  });

  it("retires events with no 'going' RSVPs", async () => {
    storageMock.getEventsPendingRecap.mockResolvedValue([
      evt({ date: dateStr(-(RECAP_DELAY_MS + 60 * 60 * 1000)), rsvps: { [MAYBE]: "maybe" } }),
    ]);

    await runEventRecapScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEventRecapSent).toHaveBeenCalledWith("evt-1");
  });
});

describe("run3DayReminderScan", () => {
  // Helper: build an event whose eventAt is msFromNow in the future and whose
  // createdAt is planAgeMs before that start — controls the plan-age gate.
  function evt3day(msFromNow: number, planAgeMs: number, over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
    const start = new Date(Date.now() + msFromNow);
    const createdAt = new Date(start.getTime() - planAgeMs);
    return {
      id: "evt-1",
      title: "BBQ",
      emoji: "🔥",
      date: "Fri, Jul 25 · 6:00 PM",
      eventAt: start.toISOString(),
      squadId: "",
      hostId: "host",
      rsvps: { [GOING]: "going" },
      createdAt: createdAt.toISOString(),
      timezone: null,
      ...over,
    };
  }

  it("sends to going RSVPs inside the 3-day window with a plan old enough, then marks sent", async () => {
    // 48h out (inside 72h window), plan created 5 days before start.
    storageMock.getEventsPending3DayReminder.mockResolvedValue([
      evt3day(48 * 60 * 60 * 1000, 5 * 24 * 60 * 60 * 1000),
    ]);
    await run3DayReminderScan();
    const [recipientIds, opts] = storageMock.getPushRecipientsForUsers.mock.calls[0] as [string[], { requireNotifyReminders?: boolean }];
    expect(recipientIds).toEqual([GOING]);
    expect(opts.requireNotifyReminders).toBe(true);
    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1);
    expect(storageMock.tryClaimEvent3DayReminderSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.markEvent3DayReminderSent).not.toHaveBeenCalled();
  });

  it("uses calendar days across the fall DST boundary even when elapsed time exceeds 72 hours", async () => {
    const now = new Date("2026-11-01T07:30:00.000Z");
    vi.useFakeTimers({ now });
    storageMock.getEventsPending3DayReminder.mockResolvedValue([
      evt3day(73 * 60 * 60 * 1000, 5 * 24 * 60 * 60 * 1000, {
        eventAt: "2026-11-04T08:30:00.000Z",
        timezone: "America/Los_Angeles",
      }),
    ]);

    await run3DayReminderScan();

    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1);
    expect(storageMock.tryClaimEvent3DayReminderSend).toHaveBeenCalledWith("evt-1");
    vi.useRealTimers();
  });

  it("does NOT send when the event is still more than 3 days out", async () => {
    // Four calendar days out → beyond the calendar-day window.
    storageMock.getEventsPending3DayReminder.mockResolvedValue([
      evt3day(4 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000, 10 * 24 * 60 * 60 * 1000),
    ]);
    await run3DayReminderScan();
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEvent3DayReminderSent).not.toHaveBeenCalled();
  });

  it("marks (without sending) when already inside the 14-hour lower boundary", async () => {
    // 10h out → inside the locked 14-hour lower boundary.
    storageMock.getEventsPending3DayReminder.mockResolvedValue([
      evt3day(10 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000),
    ]);
    await run3DayReminderScan();
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEvent3DayReminderSent).toHaveBeenCalledWith("evt-1");
  });

  it("marks (without sending) when plan age < 4 days (created too close to the event)", async () => {
    // 48h out but plan was only created 2 days before start → too fresh.
    storageMock.getEventsPending3DayReminder.mockResolvedValue([
      evt3day(48 * 60 * 60 * 1000, MIN_PLAN_AGE_FOR_3DAY_MS - 60 * 60 * 1000),
    ]);
    await run3DayReminderScan();
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEvent3DayReminderSent).toHaveBeenCalledWith("evt-1");
  });

  it("does NOT notify maybe RSVPs — only going is the audience (mirrors day-of scanner)", async () => {
    storageMock.getEventsPending3DayReminder.mockResolvedValue([
      evt3day(48 * 60 * 60 * 1000, 5 * 24 * 60 * 60 * 1000, {
        rsvps: { [GOING]: "going", [MAYBE]: "maybe" },
      }),
    ]);
    await run3DayReminderScan();
    const [recipientIds] = storageMock.getPushRecipientsForUsers.mock.calls[0] as [string[]];
    expect(recipientIds).toEqual([GOING]);
    expect(recipientIds).not.toContain(MAYBE);
  });

  it("body uses 'today'/'tomorrow' labels via the event timezone", async () => {
    // Pin now to midnight UTC. Event is 32h away, on the next calendar day.
    const fakeNow = new Date("2026-07-16T00:00:00Z");
    vi.useFakeTimers({ now: fakeNow });
    storageMock.getEventsPending3DayReminder.mockResolvedValue([
      evt3day(32 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000, { timezone: "UTC" }),
    ]);
    await run3DayReminderScan();
    vi.useRealTimers();
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).toMatch(/\btomorrow\b/i);
  });

  it("omits the day label when the event has no stored timezone", async () => {
    const fakeNow = new Date("2026-07-16T00:00:00Z");
    vi.useFakeTimers({ now: fakeNow });
    storageMock.getEventsPending3DayReminder.mockResolvedValue([
      evt3day(32 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000, {
        date: "Fri, Jul 17 · 8:00 AM",
        timezone: null,
      }),
    ]);
    await run3DayReminderScan();
    vi.useRealTimers();
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).toBe("Fri, Jul 17 · 8:00 AM");
  });

  it("skips events with no going RSVPs without marking sent (fire-and-forget would be wasteful)", async () => {
    storageMock.getEventsPending3DayReminder.mockResolvedValue([
      evt3day(48 * 60 * 60 * 1000, 5 * 24 * 60 * 60 * 1000, { rsvps: { [MAYBE]: "maybe" } }),
    ]);
    await run3DayReminderScan();
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEvent3DayReminderSent).not.toHaveBeenCalled();
  });

  it("does not mark when the send is not confirmed, so it retries next scan", async () => {
    storageMock.getEventsPending3DayReminder.mockResolvedValue([
      evt3day(48 * 60 * 60 * 1000, 5 * 24 * 60 * 60 * 1000),
    ]);
    sendPushNotificationsMock.mockResolvedValue({ staleTokens: [], okCount: 0, hadSendError: true });
    await run3DayReminderScan();
    expect(storageMock.tryClaimEvent3DayReminderSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.unclaimEvent3DayReminderSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.markEvent3DayReminderSent).not.toHaveBeenCalled();
  });
});

function poll(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "poll-1",
    title: "Find the Best Time",
    createdBy: "organizer",
    squadId: null,
    eventId: null,
    participantIds: null,
    createdAt: new Date(Date.now() - (POLL_NUDGE_MIN_AGE_MS + 60 * 60 * 1000)),
    ...over,
  };
}

describe("runPollNudgeScan", () => {
  it("nudges the organizer once the response ratio crosses the threshold, then marks sent", async () => {
    storageMock.getPollsPendingNudge.mockResolvedValue([poll()]);
    storageMock.getAvailabilityPollRoster.mockResolvedValue(["a", "b", "c"]);
    storageMock.getAvailabilityResponses.mockResolvedValue([{ userId: "a" }, { userId: "b" }]); // 2/3 ≈ 0.67

    await runPollNudgeScan();

    const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[]];
    expect(recipientIds).toEqual(["organizer"]);
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string; data: Record<string, string> }];
    expect(payload.data.pollId).toBe("poll-1");
    expect(payload.body).toContain("2 of 3");
    expect(storageMock.tryClaimPollNudgeSend).toHaveBeenCalledWith("poll-1");
    expect(storageMock.markPollNudgeSent).not.toHaveBeenCalled();
  });

  it("sends an 'everyone responded' nudge when fully answered", async () => {
    storageMock.getPollsPendingNudge.mockResolvedValue([poll()]);
    storageMock.getAvailabilityPollRoster.mockResolvedValue(["a", "b", "c"]);
    storageMock.getAvailabilityResponses.mockResolvedValue([{ userId: "a" }, { userId: "b" }, { userId: "c" }]);

    await runPollNudgeScan();

    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body.toLowerCase()).toContain("everyone");
    expect(storageMock.tryClaimPollNudgeSend).toHaveBeenCalledWith("poll-1");
    expect(storageMock.markPollNudgeSent).not.toHaveBeenCalled();
  });

  it("does nothing for too-new polls", async () => {
    storageMock.getPollsPendingNudge.mockResolvedValue([
      poll({ createdAt: new Date(Date.now() - (POLL_NUDGE_MIN_AGE_MS - 30 * 60 * 1000)) }),
    ]);

    await runPollNudgeScan();

    expect(storageMock.getAvailabilityPollRoster).not.toHaveBeenCalled();
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markPollNudgeSent).not.toHaveBeenCalled();
  });

  it("retires polls older than the max age without sending", async () => {
    storageMock.getPollsPendingNudge.mockResolvedValue([
      poll({ createdAt: new Date(Date.now() - (POLL_NUDGE_MAX_AGE_MS + 60 * 60 * 1000)) }),
    ]);

    await runPollNudgeScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markPollNudgeSent).toHaveBeenCalledWith("poll-1");
  });

  it("skips rosters that are too small, leaving the poll for a future scan", async () => {
    storageMock.getPollsPendingNudge.mockResolvedValue([poll()]);
    storageMock.getAvailabilityPollRoster.mockResolvedValue(["a", "b"]);

    await runPollNudgeScan();

    expect(storageMock.getAvailabilityResponses).not.toHaveBeenCalled();
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markPollNudgeSent).not.toHaveBeenCalled();
  });

  it("does not nudge when too few have responded", async () => {
    storageMock.getPollsPendingNudge.mockResolvedValue([poll()]);
    storageMock.getAvailabilityPollRoster.mockResolvedValue(["a", "b", "c", "d"]);
    storageMock.getAvailabilityResponses.mockResolvedValue([{ userId: "a" }]); // 1/4 = 0.25

    await runPollNudgeScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markPollNudgeSent).not.toHaveBeenCalled();
  });
});
