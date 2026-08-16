import { describe, it, expect, vi, beforeEach } from "vitest";

const storageMock = vi.hoisted(() => ({
  getEventsPendingDayOfReminder: vi.fn(),
  markEventDayOfReminderSent: vi.fn(),      // retirement only
  tryClaimDayOfReminderSend: vi.fn(),        // atomic claim before live send
  unclaimDayOfReminderSend: vi.fn(),         // release on failure
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
  filterUnmutedForSquad: vi.fn(),
  clearPushToken: vi.fn(),
}));

const sendPushNotificationsMock = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: sendPushNotificationsMock }));

import {
  runDayOfReminderScan,
  run3DayReminderScan,
  runEventRecapScan,
  runPollNudgeScan,
  REMINDER_LEAD_MS,
  DAY_OF_LEAD_MS,
  THREE_DAY_LEAD_MS,
  MIN_PLAN_AGE_FOR_3DAY_MS,
  RECAP_DELAY_MS,
  RECAP_MAX_AGE_MS,
  POLL_NUDGE_MIN_AGE_MS,
  POLL_NUDGE_MAX_AGE_MS,
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
  storageMock.markEventDayOfReminderSent.mockResolvedValue(undefined);
  storageMock.tryClaimDayOfReminderSend.mockResolvedValue(true);
  storageMock.unclaimDayOfReminderSend.mockResolvedValue(undefined);
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
  sendPushNotificationsMock.mockResolvedValue({ staleTokens: [], okCount: 1, hadSendError: false });
});

describe("runDayOfReminderScan", () => {
  it("sends a day-of heads-up to 'going' RSVPs inside the day-of window, then marks sent", async () => {
    // ~8h out: inside DAY_OF_LEAD_MS but past the 2h "starting soon" lead.
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([evt({ date: dateStr(8 * 60 * 60 * 1000) })]);

    await runDayOfReminderScan();

    const [recipientIds, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], { requireNotifyReminders?: boolean }];
    expect(recipientIds).toEqual([GOING]);
    expect(opts.requireNotifyReminders).toBe(true);
    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1);
    // Atomic claim marks before the send; direct mark is for retirement only.
    expect(storageMock.tryClaimDayOfReminderSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.markEventDayOfReminderSent).not.toHaveBeenCalled();
  });

  it("body says 'today' when the event is the same calendar day in the event timezone", async () => {
    // Pin 'now' to noon UTC so that 8h later (20:00 UTC) is still the same
    // calendar day regardless of when the CI runner executes.
    const fakeNow = new Date("2026-07-16T12:00:00Z");
    vi.useFakeTimers({ now: fakeNow });
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([
      evt({ date: dateStr(8 * 60 * 60 * 1000), timezone: "UTC" }),
    ]);
    await runDayOfReminderScan();
    vi.useRealTimers();
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).toMatch(/\btoday\b/i);
  });

  it("body says 'tomorrow' when the event is the next calendar day in the event timezone", async () => {
    // Fake now = 22:00 UTC. Event is 8h later = 06:00 UTC next day → daysUntil=1
    // in UTC ("tomorrow"). 8h is inside DAY_OF_LEAD_MS (14h) and outside
    // REMINDER_LEAD_MS (2h), so the scanner fires.
    const fakeNow = new Date("2026-07-16T22:00:00Z");
    vi.useFakeTimers({ now: fakeNow });
    const dateString = dateStr(8 * 60 * 60 * 1000);
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([
      evt({ date: dateString, timezone: "UTC" }),
    ]);
    await runDayOfReminderScan();
    vi.useRealTimers();
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).toMatch(/\btomorrow\b/i);
  });

  it("omits the day label entirely when the event has no stored timezone", async () => {
    // Regression: a 9 PM Pacific event stored without a timezone was compared
    // on the UTC calendar, where it had already rolled into the next day. The
    // push read "Coming up tomorrow — Sun, Aug 16 · 9:00 PM" — a label
    // contradicting the date printed beside it. With no timezone we now emit
    // the date text alone rather than guessing.
    const fakeNow = new Date("2026-08-16T14:41:00Z");
    vi.useFakeTimers({ now: fakeNow });
    const dateString = "Sun, Aug 16 · 9:00 PM";
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([
      evt({
        date: dateString,
        eventAt: "2026-08-17T04:00:00Z", // 9 PM Pacific = next calendar day in UTC
        timezone: null,
      }),
    ]);
    await runDayOfReminderScan();
    vi.useRealTimers();
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).not.toMatch(/\btomorrow\b/i);
    expect(payload.body).not.toMatch(/\btoday\b/i);
    expect(payload.body).toBe(dateString);
  });

  it("says 'today' for that same 9 PM Pacific event once the timezone is stored", async () => {
    const fakeNow = new Date("2026-08-16T14:41:00Z");
    vi.useFakeTimers({ now: fakeNow });
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([
      evt({
        date: "Sun, Aug 16 · 9:00 PM",
        eventAt: "2026-08-17T04:00:00Z",
        timezone: "America/Los_Angeles",
      }),
    ]);
    await runDayOfReminderScan();
    vi.useRealTimers();
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).toMatch(/\btoday\b/i);
  });

  it("omits the day label for an unrecognised timezone rather than guessing UTC", async () => {
    const fakeNow = new Date("2026-08-16T14:41:00Z");
    vi.useFakeTimers({ now: fakeNow });
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([
      evt({
        date: "Sun, Aug 16 · 9:00 PM",
        eventAt: "2026-08-17T04:00:00Z",
        timezone: "Fake/Zone",
      }),
    ]);
    await runDayOfReminderScan();
    vi.useRealTimers();
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).toBe("Sun, Aug 16 · 9:00 PM");
  });

  it("uses timezone to determine 'today' vs 'tomorrow' across midnight boundaries", async () => {
    // Simulate the classic bug: server is UTC, event is 3h ahead (still tonight),
    // but the clock just crossed midnight UTC so the event is technically
    // "tomorrow" in UTC even though it's "tonight" for the user in UTC-3.
    //
    // We fake "now" to be 23:30 UTC. The event is 3h later = 02:30 UTC next day.
    // In UTC → daysUntil=1 ("tomorrow").
    // In America/Sao_Paulo (UTC-3 in winter) → 20:30 local now, 23:30 local event → same day ("today").
    // 3h > REMINDER_LEAD_MS (2h) and < DAY_OF_LEAD_MS (14h) → scanner fires.
    const fakeNow = new Date("2026-07-16T23:30:00Z");
    vi.useFakeTimers({ now: fakeNow });
    const dateString = dateStr(3 * 60 * 60 * 1000);
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([
      evt({ date: dateString, timezone: "America/Sao_Paulo" }),
    ]);

    await runDayOfReminderScan();

    vi.useRealTimers();
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    // With the correct timezone, the event is still "today" in Sao Paulo.
    expect(payload.body).toMatch(/\btoday\b/i);
  });

  it("does NOT send for events still further out than the day-of window", async () => {
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([evt({ date: dateStr(DAY_OF_LEAD_MS + 60 * 60 * 1000) })]);

    await runDayOfReminderScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEventDayOfReminderSent).not.toHaveBeenCalled();
  });

  it("marks (without sending) when already inside the 2h soon window, to avoid a duplicate", async () => {
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([evt({ date: dateStr(REMINDER_LEAD_MS - 30 * 60 * 1000) })]);

    await runDayOfReminderScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEventDayOfReminderSent).toHaveBeenCalledWith("evt-1");
  });

  it("does not mark on a non-confirmed send so it retries (atomic claim released via unclaim)", async () => {
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([evt({ date: dateStr(8 * 60 * 60 * 1000) })]);
    sendPushNotificationsMock.mockResolvedValue({ staleTokens: [], okCount: 0, hadSendError: true });

    await runDayOfReminderScan();

    expect(storageMock.tryClaimDayOfReminderSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.unclaimDayOfReminderSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.markEventDayOfReminderSent).not.toHaveBeenCalled();
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
    const [recipientIds, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], { requireNotifyReminders?: boolean }];
    expect(recipientIds).toEqual([GOING]);
    expect(opts.requireNotifyReminders).toBe(true);
    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1);
    expect(storageMock.tryClaimEvent3DayReminderSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.markEvent3DayReminderSent).not.toHaveBeenCalled();
  });

  it("does NOT send when the event is still more than 3 days out", async () => {
    // 80h out → beyond the 72h window.
    storageMock.getEventsPending3DayReminder.mockResolvedValue([
      evt3day(THREE_DAY_LEAD_MS + 60 * 60 * 1000, 10 * 24 * 60 * 60 * 1000),
    ]);
    await run3DayReminderScan();
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEvent3DayReminderSent).not.toHaveBeenCalled();
  });

  it("marks (without sending) when already inside the day-of window to avoid a duplicate", async () => {
    // 10h out → inside DAY_OF_LEAD_MS (14h), so day-of scanner handles it.
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
    const [recipientIds] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[]];
    expect(recipientIds).toEqual([GOING]);
    expect(recipientIds).not.toContain(MAYBE);
  });

  it("body uses 'today'/'tomorrow' labels via the event timezone", async () => {
    // Pin now to midnight UTC (00:00). Event is 20h away = 20:00 UTC same day.
    // 20h is inside the 3-day window (< 72h) and outside the day-of window (> 14h),
    // so the scanner fires and the label should be "today".
    const fakeNow = new Date("2026-07-16T00:00:00Z");
    vi.useFakeTimers({ now: fakeNow });
    storageMock.getEventsPending3DayReminder.mockResolvedValue([
      evt3day(20 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000, { timezone: "UTC" }),
    ]);
    await run3DayReminderScan();
    vi.useRealTimers();
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).toMatch(/\btoday\b/i);
  });

  it("omits the day label when the event has no stored timezone", async () => {
    const fakeNow = new Date("2026-07-16T00:00:00Z");
    vi.useFakeTimers({ now: fakeNow });
    storageMock.getEventsPending3DayReminder.mockResolvedValue([
      evt3day(20 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000, {
        date: "Thu, Jul 16 · 8:00 PM",
        timezone: null,
      }),
    ]);
    await run3DayReminderScan();
    vi.useRealTimers();
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).toBe("Thu, Jul 16 · 8:00 PM");
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
