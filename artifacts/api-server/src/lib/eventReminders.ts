import { logger } from './logger';
import { sendPushNotifications } from './pushNotifications';
import { storage } from '../storage';
import { parseEventStart, relativeDayLabel, formatEventTimeIn, calendarDaysUntil } from './eventDate';
import {
  runWithSchedulerLock,
  ENGAGEMENT_SCAN_LOCK_KEY,
  PUSH_RETRY_DRAIN_LOCK_KEY,
} from './schedulerLock';

// Automatic "starting soon" event reminders. Event `date` is free-form text
// (e.g. "Sat, Jun 7 · 5:00 PM"), so we best-effort parse it and notify the
// "going" RSVPs once when the start falls inside the lead window. Each event is
// marked (reminderSentAt) so the reminder fires exactly once.
export const REMINDER_SCAN_INTERVAL_MS = 10 * 60 * 1000;
export const REMINDER_LEAD_MS = 2 * 60 * 60 * 1000;

// 3-day-out reminder: fires once per event when the start is within 3 calendar
// days but still outside the starting-soon window. Gated by a plan-age check so a
// plan created 3 days before the event doesn't trigger immediately.
export const THREE_DAY_MIN_LEAD_MS = 14 * 60 * 60 * 1000;
export const MIN_PLAN_AGE_FOR_3DAY_MS = 4 * 24 * 60 * 60 * 1000; // 96 h

// Post-event recap: prompt for photos once the event is comfortably over, but
// not so long after that it feels stale.
export const RECAP_DELAY_MS = 3 * 60 * 60 * 1000;
export const RECAP_MAX_AGE_MS = 48 * 60 * 60 * 1000;

// Owed-delivery retry pacing. A device that the provider rejected is retried
// with exponential backoff until it succeeds or the ceiling is reached, at
// which point the delivery is abandoned (and logged) rather than retried
// forever. Stale/unregistered devices are dropped immediately, not retried.
export const PUSH_RETRY_BASE_DELAY_MS = 60 * 1000;
export const PUSH_RETRY_MAX_ATTEMPTS = 5;
export const PUSH_RETRY_DRAIN_INTERVAL_MS = 2 * 60 * 1000;

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

// Recaps for multi-day trips are measured from their stored end. Plain events,
// legacy rows, and trips without a valid end retain the existing start/display
// date behavior.
function eventRecapTimeFor(
  event: { eventAt?: Date | string | null; endAt?: Date | string | null; date: string },
  now: Date,
): Date | null {
  if (event.endAt) {
    const t = event.endAt instanceof Date ? event.endAt : new Date(event.endAt);
    if (!Number.isNaN(t.getTime())) return t;
  }
  return eventStartFor(event, now);
}

export type PushRecipient = { pushToken: string; timezone: string | null };

/**
 * Group recipients by the timezone their copy should be written in, so one
 * event produces one push per distinct zone instead of one shared string.
 *
 * A recipient with no saved timezone inherits the event's stored zone (the
 * creator's). When that is also missing the group's zone is null and callers
 * degrade to the event's own date text — never to a UTC guess, which silently
 * misdates evening events in behind-UTC zones.
 */
export function groupRecipientsByZone(
  recipients: PushRecipient[],
  eventTimezone: string | null,
): Array<{ timezone: string | null; tokens: string[] }> {
  const groups = new Map<string, { timezone: string | null; tokens: string[] }>();
  const seenTokens = new Set<string>();
  for (const recipient of recipients) {
    // A stale/repeated recipient row must not result in two alerts. Keep the
    // first recipient timezone deterministically; a push token represents one
    // device and cannot accurately belong to two timezones at once.
    if (seenTokens.has(recipient.pushToken)) continue;
    seenTokens.add(recipient.pushToken);
    const zone = recipient.timezone ?? eventTimezone ?? null;
    const key = zone ?? '\u0000none';
    let group = groups.get(key);
    if (!group) {
      group = { timezone: zone, tokens: [] };
      groups.set(key, group);
    }
    group.tokens.push(recipient.pushToken);
  }
  return [...groups.values()];
}

/**
 * Expo may accept an earlier chunk before a later chunk fails. Releasing a
 * fire-once claim in that situation resends the accepted devices on the next
 * scan, which is exactly the duplicate-notification bug. Failed devices get a
 * targeted retry inside {@link sendPerZone} instead, so only a completely
 * unaccepted send releases the claim for a whole-audience retry.
 */
function shouldReleaseReminderClaim(result: { okCount: number }): boolean {
  return result.okCount === 0;
}

/**
 * Send the same notification to several timezone groups, composing the body
 * separately for each.
 *
 * Fire-once claims make partial delivery the hard case: re-running the whole
 * send would re-alert devices Expo already accepted, while dropping it would
 * silently skip the devices that failed. So the devices Expo did NOT accept are
 * persisted as owed deliveries under `dedupeKey` and retried by the drain
 * worker until they succeed or hit the attempt ceiling — the claim can stay
 * stamped without anyone being forgotten.
 */
async function sendPerZone(
  groups: Array<{ timezone: string | null; tokens: string[] }>,
  build: (zone: string | null) => { title: string; body: string; data?: Record<string, unknown> },
  dedupeKey: string,
): Promise<{ okCount: number; hadSendError: boolean; owedCount: number }> {
  let okCount = 0;
  let hadSendError = false;
  let owedCount = 0;
  for (const group of groups) {
    if (group.tokens.length === 0) continue;
    const payload = build(group.timezone);
    const onStaleToken = (token: string) => storage.clearPushToken(token);
    const result = await sendPushNotifications(group.tokens, payload, { onStaleToken });
    okCount += result.okCount;
    if (result.hadSendError) hadSendError = true;

    const unaccepted = result.failedTokens ?? [];
    if (unaccepted.length === 0) continue;

    // Durable hand-off: these specific devices are still owed this exact
    // payload. Dropping them here is what silently loses notifications.
    owedCount += unaccepted.length;
    try {
      await storage.enqueuePushRetries(
        unaccepted.map((pushToken) => ({
          dedupeKey,
          pushToken,
          payload,
          nextAttemptAt: new Date(Date.now() + PUSH_RETRY_BASE_DELAY_MS),
        })),
      );
    } catch (err) {
      logger.error({ err, dedupeKey, owed: unaccepted.length }, 'Failed to persist owed push retries');
    }
  }
  return { okCount, hadSendError, owedCount };
}

/**
 * Single-payload equivalent of {@link sendPerZone} for notifications with no
 * per-timezone copy (recap prompts, poll nudges). Same invariant: devices the
 * provider rejected become durable owed deliveries instead of being dropped.
 */
async function sendWithOwedRetry(
  tokens: string[],
  payload: { title: string; body: string; data?: Record<string, unknown> },
  dedupeKey: string,
): Promise<{ okCount: number; hadSendError: boolean; owedCount: number }> {
  const result = await sendPushNotifications(tokens, payload, {
    onStaleToken: (token) => storage.clearPushToken(token),
  });
  const unaccepted = result.failedTokens ?? [];
  if (unaccepted.length > 0) {
    try {
      await storage.enqueuePushRetries(
        unaccepted.map((pushToken) => ({
          dedupeKey,
          pushToken,
          payload,
          nextAttemptAt: new Date(Date.now() + PUSH_RETRY_BASE_DELAY_MS),
        })),
      );
    } catch (err) {
      logger.error({ err, dedupeKey, owed: unaccepted.length }, 'Failed to persist owed push retries');
    }
  }
  return { okCount: result.okCount, hadSendError: result.hadSendError, owedCount: unaccepted.length };
}

/**
 * Retry deliveries still owed to specific devices after a partial send.
 *
 * This is the other half of the fire-once claim: the claim stops duplicate
 * alerts, and this stops silent delivery loss. Each row targets ONE device with
 * the payload it never received, so draining can never re-alert a device that
 * already got the notification. Rows are removed on success, when the device is
 * unregistered, or once the attempt ceiling is reached.
 */
export async function runPushRetryDrain(): Promise<void> {
  let due: Awaited<ReturnType<typeof storage.getDuePushRetries>>;
  try {
    due = await storage.getDuePushRetries();
  } catch (err) {
    logger.error({ err }, 'Failed to load owed push retries');
    return;
  }
  if (due.length === 0) return;

  const settled: string[] = [];
  for (const row of due) {
    try {
      const result = await sendPushNotifications([row.pushToken], row.payload, {
        onStaleToken: (token) => storage.clearPushToken(token),
      });

      if (result.okCount > 0) {
        settled.push(row.id);
        continue;
      }
      // Device is unregistered — it will never accept this, so stop owing it.
      if (result.staleTokens.length > 0) {
        settled.push(row.id);
        continue;
      }

      const attempts = row.attempts + 1;
      if (attempts >= PUSH_RETRY_MAX_ATTEMPTS) {
        logger.error(
          { dedupeKey: row.dedupeKey, attempts },
          'Giving up on owed push delivery after max attempts',
        );
        settled.push(row.id);
        continue;
      }
      // Exponential backoff so a struggling provider isn't hammered.
      const delay = PUSH_RETRY_BASE_DELAY_MS * 2 ** attempts;
      await storage.reschedulePushRetry(row.id, new Date(Date.now() + delay), 'push not accepted');
    } catch (err) {
      logger.error({ err, dedupeKey: row.dedupeKey }, 'Owed push retry attempt failed');
      const attempts = row.attempts + 1;
      if (attempts >= PUSH_RETRY_MAX_ATTEMPTS) {
        settled.push(row.id);
      } else {
        const delay = PUSH_RETRY_BASE_DELAY_MS * 2 ** attempts;
        await storage
          .reschedulePushRetry(row.id, new Date(Date.now() + delay), String(err))
          .catch(() => {});
      }
    }
  }

  if (settled.length > 0) {
    try {
      await storage.deletePushRetries(settled);
    } catch (err) {
      logger.error({ err, count: settled.length }, 'Failed to clear settled push retries');
    }
  }
}

/**
 * Reminder body copy in a single reader's timezone. Falls back to the event's
 * stored date text whenever the zone can't render a trustworthy local time.
 */
export function reminderBodyFor(
  opts: {
    now: Date;
    start: Date;
    zone: string | null;
    eventDateText: string;
    prefix?: string;
  },
): string {
  const { now, start, zone, eventDateText, prefix } = opts;
  const localTime = formatEventTimeIn(start, zone) ?? eventDateText;
  const dayLabel = relativeDayLabel(now, start, zone);
  if (prefix) return `${prefix} — ${localTime}`;
  return dayLabel != null ? `Coming up ${dayLabel} — ${localTime}` : localTime;
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

    const recipients = await storage.getPushRecipientsForUsers(recipientIds, { requireNotifyReminders: true });
    if (recipients.length === 0) continue;

    // Atomic claim: sets reminderSentAt = NOW() only when still NULL. If two
    // instances race on the same event, only one UPDATE returns a row; the
    // other gets false and skips — preventing duplicate notifications.
    const claimed = await storage.tryClaimEventReminderSend(event.id);
    if (!claimed) continue; // another instance already claimed it

    try {
      const eventTz = (event as { timezone?: string | null }).timezone ?? null;
      const result = await sendPerZone(
        groupRecipientsByZone(recipients, eventTz),
        (zone) => ({
          title: `${event.emoji} ${event.title}`,
          body: reminderBodyFor({
            now, start, zone, eventDateText: event.date, prefix: 'Starting soon',
          }),
          data: { screen: event.type === 'trip' ? 'trip' : 'event', eventId: event.id },
        }),
        `event-reminder:${event.id}`,
      );
      if (!shouldReleaseReminderClaim(result)) {
        // Already marked by the atomic claim — nothing more to do.
        if (result.hadSendError) {
          logger.warn(
            { eventId: event.id, okCount: result.okCount },
            'Event reminder partially accepted; preserving claim to avoid duplicate alerts',
          );
        }
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

// 3-day-out reminder to going RSVPs, fired once per event when the start is
// within three calendar days but still outside the 14-hour lower boundary. An additional
// plan-age gate prevents plans created <4 days before the event from firing
// immediately (the organizer just made the plan — the reminder would be noise).
export async function run3DayReminderScan(): Promise<void> {
  const events = await storage.getEventsPending3DayReminder();
  const now = new Date();
  for (const event of events) {
    const start = eventStartFor(event, now);
    if (!start) continue;
    const msUntil = start.getTime() - now.getTime();

    // Starting-soon owns the final two hours; the three-day reminder's locked
    // lower boundary is 14 hours before start.
    if (msUntil <= THREE_DAY_MIN_LEAD_MS) {
      await storage.markEvent3DayReminderSent(event.id);
      continue;
    }
    const eventTz = (event as { timezone?: string | null }).timezone ?? null;
    const calendarDays = calendarDaysUntil(now, start, eventTz);
    if (calendarDays < 1 || calendarDays > 3) continue;

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

    const recipients = await storage.getPushRecipientsForUsers(recipientIds, { requireNotifyReminders: true });
    if (recipients.length === 0) continue;

    const claimed = await storage.tryClaimEvent3DayReminderSend(event.id);
    if (!claimed) continue;

    try {
      const result = await sendPerZone(
        groupRecipientsByZone(recipients, eventTz),
        (zone) => ({
          title: `${event.emoji} ${event.title}`,
          body: reminderBodyFor({ now, start, zone, eventDateText: event.date }),
          data: { screen: event.type === 'trip' ? 'trip' : 'event', eventId: event.id },
        }),
        `three-day-reminder:${event.id}`,
      );
      if (!shouldReleaseReminderClaim(result)) {
        // Already marked by the atomic claim.
        if (result.hadSendError) {
          logger.warn(
            { eventId: event.id, okCount: result.okCount },
            '3-day reminder partially accepted; preserving claim to avoid duplicate alerts',
          );
        }
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
    const recapTime = eventRecapTimeFor(event, now);
    if (!recapTime) continue;
    const msSince = now.getTime() - recapTime.getTime();
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
      const result = await sendWithOwedRetry(
        tokens,
        {
          title: `📸 How was ${event.title}?`,
          body: 'Drop your photos in the squad vault before they get lost!',
          // The trip screen's media tab is "vault"; the event screen's is
          // "photos". Sending the wrong one silently falls back to the default
          // tab, so the tap misses the thing the copy asks for.
          data: event.type === 'trip'
            ? { screen: 'trip', eventId: event.id, tab: 'vault' }
            : { screen: 'event', eventId: event.id, tab: 'photos' },
        },
        `event-recap:${event.id}`,
      );
      if (!shouldReleaseReminderClaim(result)) {
        // Already marked by the atomic claim.
        if (result.hadSendError) {
          logger.warn(
            { eventId: event.id, okCount: result.okCount },
            'Event recap partially accepted; preserving claim to avoid duplicate alerts',
          );
        }
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
      const result = await sendWithOwedRetry(
        tokens,
        {
          title: `🗓️ ${poll.title}`,
          body,
          data: { screen: 'availability', pollId: poll.id },
        },
        `poll-nudge:${poll.id}`,
      );
      if (!shouldReleaseReminderClaim(result)) {
        // Already marked by the atomic claim.
        if (result.hadSendError) {
          logger.warn(
            { pollId: poll.id, okCount: result.okCount },
            'Poll nudge partially accepted; preserving claim to avoid duplicate alerts',
          );
        }
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

/**
 * One full engagement scan pass, executed under a cross-instance scheduler
 * lock: exactly one API process performs the pass per tick, no matter how many
 * replicas share the interval. The per-event atomic claims inside each scan
 * remain as defence in depth. Scans run sequentially with individual error
 * isolation, so one failing scan never blocks the others — the same behaviour
 * the previous fire-and-forget scheduling had.
 *
 * Behaviour on a single instance is unchanged: the lock is always free, the
 * pass always runs.
 */
export async function runEngagementScanPass(): Promise<void> {
  await runWithSchedulerLock(ENGAGEMENT_SCAN_LOCK_KEY, 'engagement-scans', REMINDER_SCAN_INTERVAL_MS, async () => {
    const scans: Array<[string, () => Promise<void>]> = [
      ['Event reminder scan failed', runEventReminderScan],
      ['3-day reminder scan failed', run3DayReminderScan],
      ['Event recap scan failed', runEventRecapScan],
      ['Poll nudge scan failed', runPollNudgeScan],
    ];
    for (const [failureMessage, scan] of scans) {
      try {
        await scan();
      } catch (err) {
        logger.error({ err }, failureMessage);
      }
    }
  });
}

/**
 * Owed push-retry drain under the same cross-instance guarantee. Two replicas
 * draining the same owed rows concurrently could both send to a device before
 * either deletes the row — the lock makes that impossible.
 */
export async function runPushRetryDrainPass(): Promise<void> {
  await runWithSchedulerLock(
    PUSH_RETRY_DRAIN_LOCK_KEY,
    'push-retry-drain',
    PUSH_RETRY_DRAIN_INTERVAL_MS,
    runPushRetryDrain,
  );
}
