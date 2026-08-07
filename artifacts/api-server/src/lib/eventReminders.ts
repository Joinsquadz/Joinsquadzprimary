import { logger } from './logger';
import { sendPushNotifications } from './pushNotifications';
import { storage } from '../storage';
import { parseEventStart, calendarDaysUntil } from './eventDate';

// Automatic "starting soon" event reminders. Event `date` is free-form text
// (e.g. "Sat, Jun 7 · 5:00 PM"), so we best-effort parse it and notify the
// "going" RSVPs once when the start falls inside the lead window. Each event is
// marked (reminderSentAt) so the reminder fires exactly once.
export const REMINDER_SCAN_INTERVAL_MS = 10 * 60 * 1000;
export const REMINDER_LEAD_MS = 2 * 60 * 60 * 1000;

// "Day-of" heads-up: fire once when the event is within this lead but still more
// than the "starting soon" lead away, so the two reminders don't collide.
export const DAY_OF_LEAD_MS = 14 * 60 * 60 * 1000;

// 3-day-out reminder: fires once per event when the start is within 3 calendar
// days but still outside the day-of window. Gated by a plan-age check so a
// plan created 3 days before the event doesn't trigger immediately.
export const THREE_DAY_LEAD_MS = 3 * 24 * 60 * 60 * 1000; // 72 h
export const MIN_PLAN_AGE_FOR_3DAY_MS = 4 * 24 * 60 * 60 * 1000; // 96 h

// Post-event recap: prompt for photos once the event is comfortably over, but
// not so long after that it feels stale.
export const RECAP_DELAY_MS = 3 * 60 * 60 * 1000;
export const RECAP_MAX_AGE_MS = 48 * 60 * 60 * 1000;

// Availability-poll "almost there" organizer nudge thresholds.
export const POLL_NUDGE_MIN_AGE_MS = 2 * 60 * 60 * 1000;
export const POLL_NUDGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const POLL_NUDGE_MIN_ROSTER = 3;
export const POLL_NUDGE_RATIO = 0.6;

// Resolve an event's start time, preferring the machine-readable `eventAt`
// timestamp and falling back to best-effort parsing of the human-readable
// `date` display string. Preferring `eventAt` keeps timing accurate AND makes
// the recap max-age retirement reachable: the year-less display format rolls
// anything more than ~48h in the past forward into next year, which would
// otherwise make a stale event look perpetually upcoming and never retire.
function eventStartFor(
  event: { eventAt?: Date | string | null; date: string },
  now: Date,
): Date | null {
  if (event.eventAt) {
    const t = event.eventAt instanceof Date ? event.eventAt : new Date(event.eventAt);
    if (!Number.isNaN(t.getTime())) return t;
  }
  return parseEventStart(event.date, now);
}

export async function runEventReminderScan(): Promise<void> {
  const events = await storage.getEventsPendingReminder();
  const now = new Date();
  for (const event of events) {
    const start = eventStartFor(event, now);
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

    // Atomic claim: sets reminderSentAt = NOW() only when still NULL. If two
    // instances race on the same event, only one UPDATE returns a row; the
    // other gets false and skips — preventing duplicate notifications.
    const claimed = await storage.tryClaimEventReminderSend(event.id);
    if (!claimed) continue; // another instance already claimed it

    try {
      const result = await sendPushNotifications(
        tokens,
        {
          title: `${event.emoji} ${event.title}`,
          body: `Starting soon — ${event.date}`,
          data: { screen: 'event', eventId: event.id },
        },
        { onStaleToken: (token) => storage.clearPushToken(token) },
      );
      if (result.okCount > 0 && !result.hadSendError) {
        // Already marked by the atomic claim — nothing more to do.
      } else {
        logger.warn(
          { eventId: event.id, okCount: result.okCount, hadSendError: result.hadSendError },
          'Event reminder not confirmed sent; releasing claim for retry next scan',
        );
        await storage.unclaimEventReminderSend(event.id);
      }
    } catch (err) {
      logger.error({ err, eventId: event.id }, 'Event reminder send failed; releasing claim for retry');
      await storage.unclaimEventReminderSend(event.id);
    }
  }
}

// "Day-of" heads-up reminder to going RSVPs, fired once per event when the start
// is within DAY_OF_LEAD_MS but still further out than the 2h "starting soon"
// window (so guests get a morning-of nudge as well as the last-minute one).
export async function runDayOfReminderScan(): Promise<void> {
  const events = await storage.getEventsPendingDayOfReminder();
  const now = new Date();
  for (const event of events) {
    const start = eventStartFor(event, now);
    if (!start) continue;
    const msUntil = start.getTime() - now.getTime();
    // Past, or already inside the "starting soon" window — the soon-reminder
    // covers it; mark day-of done so we don't fire a late duplicate.
    if (msUntil <= REMINDER_LEAD_MS) {
      await storage.markEventDayOfReminderSent(event.id);
      continue;
    }
    if (msUntil > DAY_OF_LEAD_MS) continue; // too far out yet

    const rsvps = (event.rsvps ?? {}) as Record<string, string>;
    const goingIds = Object.keys(rsvps).filter((uid) => rsvps[uid] === 'going');
    if (goingIds.length === 0) continue;

    const recipientIds = event.squadId
      ? await storage.filterUnmutedForSquad(goingIds, event.squadId)
      : goingIds;
    if (recipientIds.length === 0) continue;

    const tokens = await storage.getPushTokensForUsers(recipientIds, { requireNotifyReminders: true });
    if (tokens.length === 0) continue;

    const claimed = await storage.tryClaimDayOfReminderSend(event.id);
    if (!claimed) continue;

    try {
      // Compute a calendar-day-aware label using the event's stored timezone so
      // the copy is correct in the creator's locale, not just the server's UTC.
      const daysUntil = calendarDaysUntil(now, start, (event as { timezone?: string | null }).timezone ?? null);
      const dayLabel = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : null;
      const body = dayLabel != null ? `Coming up ${dayLabel} — ${event.date}` : event.date;
      const result = await sendPushNotifications(
        tokens,
        {
          title: `${event.emoji} ${event.title}`,
          body,
          data: { screen: 'event', eventId: event.id },
        },
        { onStaleToken: (token) => storage.clearPushToken(token) },
      );
      if (result.okCount > 0 && !result.hadSendError) {
        // Already marked by the atomic claim.
      } else {
        logger.warn(
          { eventId: event.id, okCount: result.okCount, hadSendError: result.hadSendError },
          'Day-of reminder not confirmed sent; releasing claim for retry next scan',
        );
        await storage.unclaimDayOfReminderSend(event.id);
      }
    } catch (err) {
      logger.error({ err, eventId: event.id }, 'Day-of reminder send failed; releasing claim for retry');
      await storage.unclaimDayOfReminderSend(event.id);
    }
  }
}

// 3-day-out reminder to going RSVPs, fired once per event when the start is
// within THREE_DAY_LEAD_MS but still outside the day-of window. An additional
// plan-age gate prevents plans created <4 days before the event from firing
// immediately (the organizer just made the plan — the reminder would be noise).
export async function run3DayReminderScan(): Promise<void> {
  const events = await storage.getEventsPending3DayReminder();
  const now = new Date();
  for (const event of events) {
    const start = eventStartFor(event, now);
    if (!start) continue;
    const msUntil = start.getTime() - now.getTime();

    // Already inside the day-of window — mark done (day-of scanner covers it).
    if (msUntil <= DAY_OF_LEAD_MS) {
      await storage.markEvent3DayReminderSent(event.id);
      continue;
    }
    if (msUntil > THREE_DAY_LEAD_MS) continue; // still too far out

    // Plan-age gate: skip (and mark done) if the event was created fewer than
    // 4 days before its start — the reminder would fire almost immediately,
    // which is not useful to an organizer who just created the plan.
    const createdAt = event.createdAt ? new Date(event.createdAt).getTime() : now.getTime();
    const planAge = start.getTime() - createdAt;
    if (planAge < MIN_PLAN_AGE_FOR_3DAY_MS) {
      await storage.markEvent3DayReminderSent(event.id);
      continue;
    }

    const rsvps = (event.rsvps ?? {}) as Record<string, string>;
    const goingIds = Object.keys(rsvps).filter((uid) => rsvps[uid] === 'going');
    if (goingIds.length === 0) continue;

    const recipientIds = event.squadId
      ? await storage.filterUnmutedForSquad(goingIds, event.squadId)
      : goingIds;
    if (recipientIds.length === 0) continue;

    const tokens = await storage.getPushTokensForUsers(recipientIds, { requireNotifyReminders: true });
    if (tokens.length === 0) continue;

    const claimed = await storage.tryClaimEvent3DayReminderSend(event.id);
    if (!claimed) continue;

    try {
      const daysUntil = calendarDaysUntil(now, start, (event as { timezone?: string | null }).timezone ?? null);
      const dayLabel = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : null;
      const body = dayLabel != null ? `Coming up ${dayLabel} — ${event.date}` : event.date;
      const result = await sendPushNotifications(
        tokens,
        {
          title: `${event.emoji} ${event.title}`,
          body,
          data: { screen: 'event', eventId: event.id },
        },
        { onStaleToken: (token) => storage.clearPushToken(token) },
      );
      if (result.okCount > 0 && !result.hadSendError) {
        // Already marked by the atomic claim.
      } else {
        logger.warn(
          { eventId: event.id, okCount: result.okCount, hadSendError: result.hadSendError },
          '3-day reminder not confirmed sent; releasing claim for retry next scan',
        );
        await storage.unclaimEvent3DayReminderSend(event.id);
      }
    } catch (err) {
      logger.error({ err, eventId: event.id }, '3-day reminder send failed; releasing claim for retry');
      await storage.unclaimEvent3DayReminderSend(event.id);
    }
  }
}

// Post-event "drop your photos" recap prompt, fired once per event a few hours
// after it ends (within RECAP_MAX_AGE_MS) to the going RSVPs.
export async function runEventRecapScan(): Promise<void> {
  const events = await storage.getEventsPendingRecap();
  const now = new Date();
  for (const event of events) {
    const start = eventStartFor(event, now);
    if (!start) continue;
    const msSince = now.getTime() - start.getTime();
    if (msSince < RECAP_DELAY_MS) continue; // not over yet
    if (msSince > RECAP_MAX_AGE_MS) {
      // Too old to feel timely — retire it so we stop reprocessing.
      await storage.markEventRecapSent(event.id);
      continue;
    }

    const rsvps = (event.rsvps ?? {}) as Record<string, string>;
    const goingIds = Object.keys(rsvps).filter((uid) => rsvps[uid] === 'going');
    if (goingIds.length === 0) {
      await storage.markEventRecapSent(event.id);
      continue;
    }

    const recipientIds = event.squadId
      ? await storage.filterUnmutedForSquad(goingIds, event.squadId)
      : goingIds;
    if (recipientIds.length === 0) {
      await storage.markEventRecapSent(event.id);
      continue;
    }

    const tokens = await storage.getPushTokensForUsers(recipientIds, { requireNotifyReminders: true });
    if (tokens.length === 0) {
      await storage.markEventRecapSent(event.id);
      continue;
    }

    const claimed = await storage.tryClaimEventRecapSend(event.id);
    if (!claimed) continue;

    try {
      const result = await sendPushNotifications(
        tokens,
        {
          title: `📸 How was ${event.title}?`,
          body: 'Drop your photos in the squad vault before they get lost!',
          data: { screen: 'event', eventId: event.id, tab: 'photos' },
        },
        { onStaleToken: (token) => storage.clearPushToken(token) },
      );
      if (result.okCount > 0 && !result.hadSendError) {
        // Already marked by the atomic claim.
      } else {
        logger.warn(
          { eventId: event.id, okCount: result.okCount, hadSendError: result.hadSendError },
          'Event recap prompt not confirmed sent; releasing claim for retry next scan',
        );
        await storage.unclaimEventRecapSend(event.id);
      }
    } catch (err) {
      logger.error({ err, eventId: event.id }, 'Event recap prompt send failed; releasing claim for retry');
      await storage.unclaimEventRecapSend(event.id);
    }
  }
}

// Availability-poll "almost there" nudge to the organizer once most invitees
// have responded (fire-once via nudgeSentAt). Polls that never reach the
// threshold are retired after POLL_NUDGE_MAX_AGE_MS so the scan stays bounded.
export async function runPollNudgeScan(): Promise<void> {
  const polls = await storage.getPollsPendingNudge();
  const now = Date.now();
  for (const poll of polls) {
    const createdMs = poll.createdAt ? new Date(poll.createdAt).getTime() : 0;
    const age = now - createdMs;
    if (!createdMs || age > POLL_NUDGE_MAX_AGE_MS) {
      await storage.markPollNudgeSent(poll.id);
      continue;
    }
    if (age < POLL_NUDGE_MIN_AGE_MS) continue; // give people time to respond

    const roster = await storage.getAvailabilityPollRoster(poll);
    if (roster.length < POLL_NUDGE_MIN_ROSTER) continue; // too small to nudge

    const responses = await storage.getAvailabilityResponses(poll.id);
    const responded = new Set(responses.map((r) => r.userId).filter((id) => roster.includes(id)));
    const ratio = responded.size / roster.length;
    if (ratio < POLL_NUDGE_RATIO) continue; // not "almost there" yet

    const allIn = responded.size >= roster.length;
    const body = allIn
      ? `Everyone's responded — lock in the best time!`
      : `${responded.size} of ${roster.length} are in — pick a time!`;

    const recipientIds = poll.squadId
      ? await storage.filterUnmutedForSquad([poll.createdBy], poll.squadId)
      : [poll.createdBy];
    if (recipientIds.length === 0) {
      await storage.markPollNudgeSent(poll.id);
      continue;
    }

    const tokens = await storage.getPushTokensForUsers(recipientIds, { requireNotifyReminders: true });
    if (tokens.length === 0) {
      await storage.markPollNudgeSent(poll.id);
      continue;
    }

    const claimed = await storage.tryClaimPollNudgeSend(poll.id);
    if (!claimed) continue;

    try {
      const result = await sendPushNotifications(
        tokens,
        {
          title: `🗓️ ${poll.title}`,
          body,
          data: { screen: 'availability', pollId: poll.id },
        },
        { onStaleToken: (token) => storage.clearPushToken(token) },
      );
      if (result.okCount > 0 && !result.hadSendError) {
        // Already marked by the atomic claim.
      } else {
        logger.warn(
          { pollId: poll.id, okCount: result.okCount, hadSendError: result.hadSendError },
          'Poll nudge not confirmed sent; releasing claim for retry next scan',
        );
        await storage.unclaimPollNudgeSend(poll.id);
      }
    } catch (err) {
      logger.error({ err, pollId: poll.id }, 'Poll nudge send failed; releasing claim for retry');
      await storage.unclaimPollNudgeSend(poll.id);
    }
  }
}
