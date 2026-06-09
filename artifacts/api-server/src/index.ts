import { runMigrations } from 'stripe-replit-sync';
import { getStripeSync } from './stripeClient';
import app from './app';
import { logger } from './lib/logger';
import { getSmtpStatus } from './emailService';
import { checkPushReceipts, initPushTickets, sendPushNotifications } from './lib/pushNotifications';
import { storage } from './storage';
import { parseEventStart } from './lib/eventDate';
import { db, squadsTable } from '@workspace/db';
import { isNull } from 'drizzle-orm';

const rawPort = process.env['PORT'];

if (!rawPort) {
  throw new Error('PORT environment variable is required but was not provided.');
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.warn('DATABASE_URL not set — skipping Stripe initialization');
    return;
  }

  try {
    logger.info('Initializing Stripe schema...');
    await runMigrations({ databaseUrl });
    logger.info('Stripe schema ready');

    const stripeSync = await getStripeSync();

    const webhookBaseUrl = `https://${process.env.REPLIT_DOMAINS?.split(',')[0]}`;
    logger.info({ webhookUrl: `${webhookBaseUrl}/api/stripe/webhook` }, 'Setting up managed webhook...');
    await stripeSync.findOrCreateManagedWebhook(`${webhookBaseUrl}/api/stripe/webhook`);
    logger.info('Webhook configured');

    // `syncBackfill` requires an explicit `object` — calling it with no args
    // makes `object` default to a function reference (not the string "all"),
    // so the internal switch matches nothing and silently syncs zero rows.
    // Pass `{ object: 'all' }` to backfill every supported entity (products,
    // prices, subscriptions, …) so checkout can find the Pro plan.
    stripeSync.syncBackfill({ object: 'all' })
      .then(() => logger.info('Stripe data synced'))
      .catch((err) => logger.error({ err }, 'Error syncing Stripe data'));
  } catch (err) {
    logger.warn({ err }, 'Stripe initialization skipped — connect Stripe via the Integrations tab to enable payments');
  }
}

await initStripe();

initPushTickets().catch((err) =>
  logger.error({ err }, "initPushTickets failed at startup"),
);

const smtpStatus = getSmtpStatus();
if (smtpStatus.configured) {
  logger.info(
    { host: smtpStatus.host, port: smtpStatus.port, user: smtpStatus.user, from: smtpStatus.from },
    'SMTP transport configured — emails will send via SendGrid'
  );
} else {
  logger.warn(
    { missing: smtpStatus.missing },
    'SMTP transport NOT configured — emails will be logged only. Set missing env vars to enable SendGrid.'
  );
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, 'Error listening on port');
    process.exit(1);
  }
  logger.info({ port }, 'Server listening');

  // Warn if any squads are missing invite codes. Run pnpm --filter
  // @workspace/scripts run backfill-squad-invite-codes to fix them.
  db.select({ id: squadsTable.id })
    .from(squadsTable)
    .where(isNull(squadsTable.inviteCode))
    .then((rows) => {
      if (rows.length > 0) {
        logger.warn(
          { count: rows.length },
          'WARNING: squads are missing invite codes. Run: pnpm --filter @workspace/scripts run backfill-squad-invite-codes',
        );
      }
    })
    .catch((err) => logger.error({ err }, 'Error checking for squads missing invite codes'));
});

// Expo recommends checking push receipts at least 15 minutes after sending so
// APNs/FCM has had time to report delivery status. Run the check on that cadence.
const RECEIPT_CHECK_INTERVAL_MS = 15 * 60 * 1000;
logger.info(
  { intervalMs: RECEIPT_CHECK_INTERVAL_MS },
  'Push receipt check scheduled',
);
setInterval(() => {
  logger.info('Running scheduled push receipt check');
  checkPushReceipts({ onStaleToken: (token) => storage.clearPushToken(token) })
    .then(({ staleTokens }) => {
      if (staleTokens.length > 0) {
        logger.info(
          { count: staleTokens.length },
          'Cleared stale push tokens found via receipt check',
        );
      } else {
        logger.info('Push receipt check complete — no stale tokens');
      }
    })
    .catch((err) => logger.error({ err }, 'Push receipt check failed'));
}, RECEIPT_CHECK_INTERVAL_MS).unref();

// Automatic "starting soon" event reminders. Event `date` is free-form text
// (e.g. "Sat, Jun 7 · 5:00 PM"), so we best-effort parse it and notify the
// "going" RSVPs once when the start falls inside the lead window. Each event is
// marked (reminderSentAt) so the reminder fires exactly once.
const REMINDER_SCAN_INTERVAL_MS = 10 * 60 * 1000;
const REMINDER_LEAD_MS = 2 * 60 * 60 * 1000;

async function runEventReminderScan(): Promise<void> {
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

logger.info({ intervalMs: REMINDER_SCAN_INTERVAL_MS }, 'Event reminder scan scheduled');
setInterval(() => {
  runEventReminderScan().catch((err) => logger.error({ err }, 'Event reminder scan failed'));
}, REMINDER_SCAN_INTERVAL_MS).unref();
