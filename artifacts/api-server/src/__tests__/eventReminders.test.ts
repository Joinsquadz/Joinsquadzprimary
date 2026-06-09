import { describe, it, expect, vi, beforeEach } from "vitest";

const storageMock = vi.hoisted(() => ({
  getEventsPendingReminder: vi.fn(),
  markEventReminderSent: vi.fn(),
  getPushTokensForUsers: vi.fn(),
  filterUnmutedForSquad: vi.fn(),
  clearPushToken: vi.fn(),
}));

const sendPushNotificationsMock = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({ storage: storageMock }));
vi.mock("../lib/logger");
vi.mock("../lib/pushNotifications", () => ({ sendPushNotifications: sendPushNotificationsMock }));

import { runEventReminderScan, REMINDER_LEAD_MS } from "../lib/eventReminders";

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
    date: dateStr(REMINDER_LEAD_MS - 30 * 60 * 1000), // ~90 min out, inside window
    squadId: "",
    hostId: "host",
    rsvps: { [GOING]: "going", [MAYBE]: "maybe" },
    reminderSentAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.filterUnmutedForSquad.mockImplementation(async (ids: string[]) => ids);
  storageMock.getPushTokensForUsers.mockResolvedValue(["ExponentPushToken[x]"]);
  storageMock.markEventReminderSent.mockResolvedValue(undefined);
  storageMock.clearPushToken.mockResolvedValue(undefined);
  sendPushNotificationsMock.mockResolvedValue({ staleTokens: [] });
});

describe("runEventReminderScan", () => {
  it("notifies only 'going' RSVPs with the Reminders pref, then marks sent", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([evt()]);

    await runEventReminderScan();

    const [recipientIds, opts] = storageMock.getPushTokensForUsers.mock.calls[0] as [string[], { requireNotifyReminders?: boolean }];
    expect(recipientIds).toEqual([GOING]);
    expect(opts.requireNotifyReminders).toBe(true);
    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1);
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { data: Record<string, string> }];
    expect(payload.data.screen).toBe("event");
    expect(storageMock.markEventReminderSent).toHaveBeenCalledWith("evt-1");
  });

  it("does NOT mark sent when there are no 'going' RSVPs yet (late RSVPs still get reminded)", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([evt({ rsvps: { [MAYBE]: "maybe" } })]);

    await runEventReminderScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEventReminderSent).not.toHaveBeenCalled();
  });

  it("does NOT send (or mark) for events still outside the lead window", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([
      evt({ date: dateStr(REMINDER_LEAD_MS + 60 * 60 * 1000) }), // ~3h out
    ]);

    await runEventReminderScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEventReminderSent).not.toHaveBeenCalled();
  });

  it("marks past events sent without sending, to stop reprocessing", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([
      evt({ date: dateStr(-60 * 60 * 1000) }), // 1h ago
    ]);

    await runEventReminderScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEventReminderSent).toHaveBeenCalledWith("evt-1");
  });

  it("leaves unparseable dates untouched for a future scan", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([evt({ date: "TBD" })]);

    await runEventReminderScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEventReminderSent).not.toHaveBeenCalled();
  });

  it("does NOT mark sent when the send fails (so it retries next scan)", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([evt()]);
    sendPushNotificationsMock.mockRejectedValue(new Error("expo down"));

    await runEventReminderScan();

    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1);
    expect(storageMock.markEventReminderSent).not.toHaveBeenCalled();
  });

  it("applies per-squad mute for squad events and suppresses when all muted", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([evt({ squadId: "squad-1" })]);
    storageMock.filterUnmutedForSquad.mockResolvedValue([]); // everyone muted

    await runEventReminderScan();

    expect(storageMock.filterUnmutedForSquad).toHaveBeenCalledWith([GOING], "squad-1");
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEventReminderSent).not.toHaveBeenCalled();
  });

  it("suppresses when 'going' users have the Reminders pref off (no tokens)", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([evt()]);
    storageMock.getPushTokensForUsers.mockResolvedValue([]); // pref off / no device

    await runEventReminderScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEventReminderSent).not.toHaveBeenCalled();
  });
});
