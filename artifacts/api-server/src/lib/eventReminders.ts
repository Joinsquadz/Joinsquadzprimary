import { logger } from './logger';
import { sendPushNotifications } from './pushNotifications';
import { storage } from '../storage';
import { parseEventStart } from './eventDate';

// Automatic "starting soon" event reminders. Event `date` is free-form text
// (e.g. "Sat, Jun 7 · 5:00 PM"), so we best-effort parse it and notify the
// "going" RSVPs once when the start falls inside the lead window. Each event is
// marked (reminderSentAt) so the reminder fires exactly once.
export const REMINDER_SCAN_INTERVAL_MS = 10 * 60 * 1000;
export const REMINDER_LEAD_MS = 2 * 60 * 60 * 1000;

export async function runEventReminderScan(): Promise<void> {
  const events = await storage.getEventsPendingReminder();
  const now = new Date();
  for (const event of events) {
    const start = parseEventStart(event.date, now);
    if (!start) continue; // unparseable — leave for a future scan
    const msUntil = start.getTime() - now.getTime();
    if (msUntil <= 0) {
      // Already started/past — mark so we stop reprocessing it.
      await storage.markEventReminderSent(event.id);
      continue;
    }
    if (msUntil > REMINDER_LEAD_MS) continue; // too far out yet

    const rsvps = (event.rsvps ?? {}) as Record<string, string>;
    const goingIds = Object.keys(rsvps).filter((uid) => rsvps[uid] === 'going');
    // Don't mark yet: someone may RSVP "going" later in the window, and a
    // transient send failure should be retried on the next scan. The event is
    // only marked sent after a successful delivery (or once it's past, above).
    if (goingIds.length === 0) continue;

    // Squad events respect per-squad mute; standalone events skip the filter.
    const recipientIds = event.squadId
      ? await storage.filterUnmutedForSquad(goingIds, event.squadId)
      : goingIds;
    if (recipientIds.length === 0) continue;

    const tokens = await storage.getPushTokensForUsers(recipientIds, { requireNotifyReminders: true });
    if (tokens.length === 0) continue;

    try {
      await sendPushNotifications(
        tokens,
        {
          title: `${event.emoji} ${event.title}`,
          body: `Starting soon — ${event.date}`,
          data: { screen: 'event', eventId: event.id },
        },
        { onStaleToken: (token) => storage.clearPushToken(token) },
      );
      await storage.markEventReminderSent(event.id);
    } catch (err) {
      logger.error({ err, eventId: event.id }, 'Event reminder send failed; will retry');
    }
  }
}
