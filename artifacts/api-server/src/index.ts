import { runMigrations } from 'stripe-replit-sync';
import { getStripeSync, getStripeDbConfig } from './stripeClient';
import app from './app';
import { logger } from './lib/logger';
import { getSmtpStatus } from './emailService';
import { checkPushReceipts, initPushTickets } from './lib/pushNotifications';
import { storage } from './storage';
import { REMINDER_SCAN_INTERVAL_MS, runEventReminderScan } from './lib/eventReminders';
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
  if (!process.env.SUPABASE_DB_URL && !process.env.DATABASE_URL) {
    logger.warn('No database connection string set — skipping Stripe initialization');
    return;
  }

  // Stripe schema + sync MUST target the SAME database the app reads through
  // (resolveDbConfig prefers SUPABASE_DB_URL). Otherwise the sync writes
  // stripe.* into a different DB and app reads 500 with "relation does not exist".
  const { databaseUrl, ssl } = getStripeDbConfig();

  try {
    logger.info('Initializing Stripe schema...');
    // Pass our logger so migration errors surface (the library no-ops silently
    // without one — a missing migrations dir or failed migration would otherwise
    // leave the stripe.* tables uncreated while still logging "schema ready").
    await runMigrations({ databaseUrl, ...(ssl ? { ssl } : {}), logger });
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

// Automatic "starting soon" event reminders (logic in ./lib/eventReminders).
logger.info({ intervalMs: REMINDER_SCAN_INTERVAL_MS }, 'Event reminder scan scheduled');
setInterval(() => {
  runEventReminderScan().catch((err) => logger.error({ err }, 'Event reminder scan failed'));
}, REMINDER_SCAN_INTERVAL_MS).unref();
