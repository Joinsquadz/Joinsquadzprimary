import { describe, it, expect, vi, beforeEach } from "vitest";

const storageMock = vi.hoisted(() => ({
  getEventsPendingReminder: vi.fn(),
  markEventReminderSent: vi.fn(),      // retirement (past events) only
  tryClaimEventReminderSend: vi.fn(),  // atomic claim before live send
  unclaimEventReminderSend: vi.fn(),   // release claim on send failure
  getPushRecipientsForUsers: vi.fn(),
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
  storageMock.getPushRecipientsForUsers.mockResolvedValue([{ pushToken: "ExponentPushToken[x]", timezone: null }]);
  storageMock.markEventReminderSent.mockResolvedValue(undefined);
  storageMock.tryClaimEventReminderSend.mockResolvedValue(true); // default: claim succeeds
  storageMock.unclaimEventReminderSend.mockResolvedValue(undefined);
  storageMock.clearPushToken.mockResolvedValue(undefined);
  sendPushNotificationsMock.mockResolvedValue({ staleTokens: [], okCount: 1, hadSendError: false });
});

describe("runEventReminderScan", () => {
  it("notifies only 'going' RSVPs with the Reminders pref; uses atomic claim before send", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([evt()]);

    await runEventReminderScan();

    const [recipientIds, opts] = storageMock.getPushRecipientsForUsers.mock.calls[0] as [string[], { requireNotifyReminders?: boolean }];
    expect(recipientIds).toEqual([GOING]);
    expect(opts.requireNotifyReminders).toBe(true);
    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1);
    const [, payload] = sendPushNotificationsMock.mock.calls[0] as [unknown, { data: Record<string, string> }];
    expect(payload.data.screen).toBe("event");
    // Atomic claim marks the event before the send (fire-once guarantee).
    expect(storageMock.tryClaimEventReminderSend).toHaveBeenCalledWith("evt-1");
    // The direct mark is only for retirement (past events), not live sends.
    expect(storageMock.markEventReminderSent).not.toHaveBeenCalled();
    // No unclaim needed on a successful send.
    expect(storageMock.unclaimEventReminderSend).not.toHaveBeenCalled();
  });

  it("skips send when another instance already claimed the event (tryClaimEventReminderSend returns false)", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([evt()]);
    storageMock.tryClaimEventReminderSend.mockResolvedValue(false); // another instance beat us

    await runEventReminderScan();

    // Tokens are fetched before the claim, but the send is skipped.
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.unclaimEventReminderSend).not.toHaveBeenCalled();
  });

  it("does NOT attempt claim when there are no 'going' RSVPs yet (late RSVPs still get reminded)", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([evt({ rsvps: { [MAYBE]: "maybe" } })]);

    await runEventReminderScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.tryClaimEventReminderSend).not.toHaveBeenCalled();
    expect(storageMock.markEventReminderSent).not.toHaveBeenCalled();
  });

  it("does NOT send (or claim) for events still outside the lead window", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([
      evt({ date: dateStr(REMINDER_LEAD_MS + 60 * 60 * 1000) }), // ~3h out
    ]);

    await runEventReminderScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.tryClaimEventReminderSend).not.toHaveBeenCalled();
    expect(storageMock.markEventReminderSent).not.toHaveBeenCalled();
  });

  it("marks past events sent directly (retirement path, no claim) to stop reprocessing", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([
      evt({ date: dateStr(-60 * 60 * 1000) }), // 1h ago
    ]);

    await runEventReminderScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    // Retirement uses the unconditional mark (safe: idempotent, no notification sent).
    expect(storageMock.markEventReminderSent).toHaveBeenCalledWith("evt-1");
    // No claim needed for retirement.
    expect(storageMock.tryClaimEventReminderSend).not.toHaveBeenCalled();
  });

  it("leaves unparseable dates untouched for a future scan", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([evt({ date: "TBD" })]);

    await runEventReminderScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.markEventReminderSent).not.toHaveBeenCalled();
    expect(storageMock.tryClaimEventReminderSend).not.toHaveBeenCalled();
  });

  it("releases the claim (unclaim) on a non-throwing submission failure so it retries next scan", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([evt()]);
    sendPushNotificationsMock.mockResolvedValue({ staleTokens: [], okCount: 0, hadSendError: true });

    await runEventReminderScan();

    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1);
    expect(storageMock.tryClaimEventReminderSend).toHaveBeenCalledWith("evt-1");
    // Claim is released so the next scan can retry.
    expect(storageMock.unclaimEventReminderSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.markEventReminderSent).not.toHaveBeenCalled();
  });

  it("releases the claim when nothing was accepted (e.g. all tokens stale)", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([evt()]);
    sendPushNotificationsMock.mockResolvedValue({ staleTokens: ["ExponentPushToken[x]"], okCount: 0, hadSendError: false });

    await runEventReminderScan();

    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1);
    expect(storageMock.tryClaimEventReminderSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.unclaimEventReminderSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.markEventReminderSent).not.toHaveBeenCalled();
  });

  it("releases the claim if the send throws unexpectedly, enabling a retry", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([evt()]);
    sendPushNotificationsMock.mockRejectedValue(new Error("expo down"));

    await runEventReminderScan();

    expect(storageMock.tryClaimEventReminderSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.unclaimEventReminderSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.markEventReminderSent).not.toHaveBeenCalled();
  });

  it("applies per-squad mute and does NOT claim when all recipients are muted", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([evt({ squadId: "squad-1" })]);
    storageMock.filterUnmutedForSquad.mockResolvedValue([]); // everyone muted

    await runEventReminderScan();

    expect(storageMock.filterUnmutedForSquad).toHaveBeenCalledWith([GOING], "squad-1");
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.tryClaimEventReminderSend).not.toHaveBeenCalled();
    expect(storageMock.markEventReminderSent).not.toHaveBeenCalled();
  });

  it("suppresses when 'going' users have the Reminders pref off (no tokens) — no claim attempted", async () => {
    storageMock.getEventsPendingReminder.mockResolvedValue([evt()]);
    storageMock.getPushRecipientsForUsers.mockResolvedValue([]); // pref off / no device

    await runEventReminderScan();

    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
    expect(storageMock.tryClaimEventReminderSend).not.toHaveBeenCalled();
    expect(storageMock.markEventReminderSent).not.toHaveBeenCalled();
  });

  it("time-window guard: near-term events are processed, far-future ones are skipped by the scanner", async () => {
    // Both events are returned by the mock (simulating DB).
    // The scanner's JS window check should process only the near-term one.
    storageMock.getEventsPendingReminder.mockResolvedValue([
      evt({ date: dateStr(REMINDER_LEAD_MS - 30 * 60 * 1000) }),  // inside window (~90 min)
      evt({ id: "evt-far", date: dateStr(REMINDER_LEAD_MS + 2 * 60 * 60 * 1000) }), // outside window (~4h)
    ]);

    await runEventReminderScan();

    expect(storageMock.tryClaimEventReminderSend).toHaveBeenCalledTimes(1);
    expect(storageMock.tryClaimEventReminderSend).toHaveBeenCalledWith("evt-1");
    expect(storageMock.tryClaimEventReminderSend).not.toHaveBeenCalledWith("evt-far");
  });
});
