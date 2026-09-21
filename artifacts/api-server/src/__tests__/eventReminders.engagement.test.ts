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
  runDayOfReminderScan,
  run3DayReminderScan,
  runEventRecapScan,
  runPollNudgeScan,
  groupRecipientsByZone,
  REMINDER_LEAD_MS,
  DAY_OF_LEAD_MS,
  THREE_DAY_LEAD_MS,
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

describe("runDayOfReminderScan", () => {
  it("sends a day-of heads-up to 'going' RSVPs inside the day-of window, then marks sent", async () => {
    // ~8h out: inside DAY_OF_LEAD_MS but past the 2h "starting soon" lead.
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([evt({ date: dateStr(8 * 60 * 60 * 1000) })]);

    await runDayOfReminderScan();

    const [recipientIds, opts] = storageMock.getPushRecipientsForUsers.mock.calls[0] as [string[], { requireNotifyReminders?: boolean }];
    expect(recipientIds).toEqual([GOING]);
    expect(opts.requireNotifyReminders).toBe(true);
    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1);
    // Atomic claim marks before the send; direct mark is for retirement only.
    expect(storageMock.tryClaimDayOfReminderSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.markEventDayOfReminderSent).not.toHaveBeenCalled();
  });

  it("writes one push per distinct recipient timezone, each on that reader's clock", async () => {
    // Same instant, two readers, ~11h out (inside the day-of window). In LA the
    // event is 6:00 PM *today*; in Tokyo the same instant is already 10:00 AM
    // *tomorrow*. One shared body necessarily misdates it for one of them.
    const fakeNow = new Date("2026-07-15T14:00:00Z");
    vi.useFakeTimers({ now: fakeNow });
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([
      evt({ eventAt: new Date("2026-07-16T01:00:00Z"), timezone: "America/Los_Angeles" }),
    ]);
    storageMock.getPushRecipientsForUsers.mockResolvedValue([
      { pushToken: "ExponentPushToken[la]", timezone: "America/Los_Angeles" },
      { pushToken: "ExponentPushToken[tokyo]", timezone: "Asia/Tokyo" },
    ]);

    await runDayOfReminderScan();
    vi.useRealTimers();

    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(2);
    const bodies = sendPushNotificationsMock.mock.calls.map(
      (c) => (c as [string[], { body: string }])[1].body,
    );
    const tokenGroups = sendPushNotificationsMock.mock.calls.map((c) => (c as [string[]])[0]);
    expect(tokenGroups).toEqual([["ExponentPushToken[la]"], ["ExponentPushToken[tokyo]"]]);
    expect(bodies[0]).toContain("Wed, Jul 15 · 6:00 PM PDT");
    expect(bodies[0]).toMatch(/\btoday\b/i);
    // Tokyo is already on the next calendar day for the same instant.
    expect(bodies[1]).toContain("Thu, Jul 16 · 10:00 AM");
    expect(bodies[1]).toMatch(/\btomorrow\b/i);
  });

  it("falls back to the event's timezone for recipients who have not set one", async () => {
    const fakeNow = new Date("2026-07-15T14:00:00Z");
    vi.useFakeTimers({ now: fakeNow });
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([
      evt({ eventAt: new Date("2026-07-16T01:00:00Z"), timezone: "America/Los_Angeles" }),
    ]);
    storageMock.getPushRecipientsForUsers.mockResolvedValue([
      { pushToken: "ExponentPushToken[none]", timezone: null },
    ]);

    await runDayOfReminderScan();
    vi.useRealTimers();

    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1);
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    expect(payload.body).toContain("Wed, Jul 15 · 6:00 PM PDT");
  });

  it("degrades to the event's date text when neither reader nor event has a timezone", async () => {
    const fakeNow = new Date("2026-07-15T14:00:00Z");
    vi.useFakeTimers({ now: fakeNow });
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([
      evt({
        eventAt: new Date("2026-07-16T01:00:00Z"),
        date: "Wed, Jul 15 · 6:00 PM",
        timezone: null,
      }),
    ]);
    storageMock.getPushRecipientsForUsers.mockResolvedValue([
      { pushToken: "ExponentPushToken[none]", timezone: null },
    ]);

    await runDayOfReminderScan();
    vi.useRealTimers();

    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { body: string }];
    // No trustworthy local time and no day label — the stored text stands alone.
    expect(payload.body).toBe("Wed, Jul 15 · 6:00 PM");
  });

  it("keeps the claim when one timezone group is accepted and another fails", async () => {
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([
      evt({ date: dateStr(8 * 60 * 60 * 1000), timezone: "UTC" }),
    ]);
    storageMock.getPushRecipientsForUsers.mockResolvedValue([
      { pushToken: "ExponentPushToken[a]", timezone: "UTC" },
      { pushToken: "ExponentPushToken[b]", timezone: "Asia/Tokyo" },
    ]);
    sendPushNotificationsMock
      .mockResolvedValueOnce({ staleTokens: [], okCount: 1, hadSendError: false })
      .mockResolvedValueOnce({ staleTokens: [], okCount: 0, hadSendError: true });

    await runDayOfReminderScan();

    // Retrying this group would resend the device Expo already accepted.
    expect(storageMock.unclaimDayOfReminderSend).not.toHaveBeenCalled();
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

  it("keeps the claim after partial provider acceptance so accepted devices are never resent", async () => {
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([evt({ date: dateStr(8 * 60 * 60 * 1000) })]);
    sendPushNotificationsMock.mockResolvedValue({ staleTokens: [], okCount: 1, hadSendError: true });

    await runDayOfReminderScan();

    expect(storageMock.tryClaimDayOfReminderSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.unclaimDayOfReminderSend).not.toHaveBeenCalled();
  });

  it("records the devices Expo rejected as still owed, without re-alerting accepted ones", async () => {
    storageMock.getEventsPendingDayOfReminder.mockResolvedValue([evt({ date: dateStr(8 * 60 * 60 * 1000) })]);
    storageMock.getPushRecipientsForUsers.mockResolvedValue([
      { pushToken: "ExponentPushToken[ok]", timezone: "UTC" },
      { pushToken: "ExponentPushToken[bad]", timezone: "UTC" },
    ]);
    sendPushNotificationsMock.mockResolvedValue({
      staleTokens: [],
      okCount: 1,
      hadSendError: true,
      failedTokens: ["ExponentPushToken[bad]"],
    });

    await runDayOfReminderScan();

    // The claim stays (the accepted device must not be alerted twice)...
    expect(storageMock.unclaimDayOfReminderSend).not.toHaveBeenCalled();
    // ...and the rejected device is durably owed the delivery, so it is not lost.
    expect(storageMock.enqueuePushRetries).toHaveBeenCalledTimes(1);
    const owed = storageMock.enqueuePushRetries.mock.calls[0][0];
    expect(owed).toHaveLength(1);
    expect(owed[0].pushToken).toBe("ExponentPushToken[bad]");
    expect(owed[0].dedupeKey).toBe("day-of-reminder:evt-1");
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
    const [recipientIds] = storageMock.getPushRecipientsForUsers.mock.calls[0] as [string[]];
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
