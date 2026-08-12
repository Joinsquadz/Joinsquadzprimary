import { runMigrations } from 'stripe-replit-sync';
import { getStripeSync, getStripeDbConfig } from './stripeClient';
import app from './app';
import { logger } from './lib/logger';
import { getSmtpStatus } from './emailService';
import { ensureEmailDedupTable } from './lib/emailDedup';
import { ensureTombstoneTable } from './lib/accountTombstones';
import { ensureSchema } from './lib/schemaSync';
import { migrateEmbeddedEventMessages } from './lib/eventChatMigration';
import { initPgPubSub } from './lib/pgPubSub';
import { checkPushReceipts, initPushTickets } from './lib/pushNotifications';
import { storage } from './storage';
import {
  REMINDER_SCAN_INTERVAL_MS,
  runEventReminderScan,
  runDayOfReminderScan,
  run3DayReminderScan,
  runEventRecapScan,
  runPollNudgeScan,
} from './lib/eventReminders';
import { runPoolHealthCheck, POOL_MONITOR_INTERVAL_MS } from './lib/poolMonitor';
import { scheduleMediaBackup, scheduleMediaBackupFreshnessCheck } from './lib/mediaBackup';
import { scheduleAccountMediaCleanupRetries } from './lib/accountMediaCleanup';
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
  if (process.env.SKIP_STRIPE_INIT) {
    logger.info('Stripe initialization skipped (SKIP_STRIPE_INIT is set)');
    return;
  }
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
    const webhookUrl = `${webhookBaseUrl}/api/stripe/webhook`;
    logger.info({ webhookUrl }, 'Setting up managed webhook in the background...');

    // Webhook provisioning makes a remote Stripe API call. Never keep the HTTP
    // server from binding while it is in flight: the publishing health probe
    // would otherwise kill a healthy process before it can serve traffic.
    stripeSync.findOrCreateManagedWebhook(webhookUrl)
      .then(() => logger.info('Webhook configured'))
      .catch((err) => logger.error({ err }, 'Managed webhook setup failed'));

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

// Idempotent startup schema sync — creates any tables/columns that exist in
// the Drizzle schema but were not yet migrated to the live DB.  Runs before
// everything else so routes never hit a "relation does not exist" 500.
await ensureSchema();

// One-way backfill of the legacy embedded `events.messages` JSON into
// conversation threads. Idempotent + self-draining, so it becomes a no-op once
// every plan's chat has moved across.
await migrateEmbeddedEventMessages();

await initStripe();

// UNC-02: ensure the webhook email dedup table exists before any Stripe webhook
// could fire and attempt to send a duplicate transactional email.
await ensureEmailDedupTable();

// Account-deletion tombstones: must exist before any DELETE /account or login
// so deleted credentials can never re-provision an account.
await ensureTombstoneTable();

// Start the Postgres LISTEN client so real-time SSE updates propagate across
// all server instances. A non-fatal failure is logged and the 20 s poll
// fallback on every SSE stream keeps the app functional.
initPgPubSub().catch((err) =>
  logger.error({ err }, "initPgPubSub failed at startup — SSE will fall back to polling"),
);

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
  logger.info(
    { DB_POOL_MAX: Number(process.env.DB_POOL_MAX ?? '45'), source: process.env.DB_POOL_MAX ? 'env' : 'default' },
    '[db-pool] effective pool max',
  );

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

// DB connection-pool health monitor — runs a lightweight pg_stat_activity query
// every 5 minutes, logs a snapshot, and sends a Sentry WARNING if pool usage
// crosses 80% of DB_POOL_MAX or any requests are queued waiting for a conn.
logger.info({ intervalMs: POOL_MONITOR_INTERVAL_MS }, 'DB pool health monitor scheduled');
runPoolHealthCheck().catch((err) => logger.error({ err }, 'Initial pool health check failed'));
setInterval(() => {
  runPoolHealthCheck().catch((err) => logger.error({ err }, 'Pool health check failed'));
}, POOL_MONITOR_INTERVAL_MS).unref();

// Automatic engagement scans (logic in ./lib/eventReminders): "starting soon"
// + "day-of" reminders, post-event photo recap prompt, and the availability
// poll "almost there" organizer nudge. All are fire-once and idempotent.
logger.info({ intervalMs: REMINDER_SCAN_INTERVAL_MS }, 'Engagement scans scheduled');
setInterval(() => {
  runEventReminderScan().catch((err) => logger.error({ err }, 'Event reminder scan failed'));
  runDayOfReminderScan().catch((err) => logger.error({ err }, 'Day-of reminder scan failed'));
  run3DayReminderScan().catch((err) => logger.error({ err }, '3-day reminder scan failed'));
  runEventRecapScan().catch((err) => logger.error({ err }, 'Event recap scan failed'));
  runPollNudgeScan().catch((err) => logger.error({ err }, 'Poll nudge scan failed'));
}, REMINDER_SCAN_INTERVAL_MS).unref();

// Nightly Supabase Storage -> Cloudflare R2 media backup. Runs at 03:30
// America/New_York (the app's primary timezone) — well after evening plan
// activity and before morning traffic. A Postgres advisory lock makes exactly
// one autoscale instance perform the copy.
scheduleMediaBackup();
scheduleMediaBackupFreshnessCheck();

// Retry storage deletions that failed while purging a deleted account, so a
// Supabase/R2 outage during deletion never leaves that user's media behind.
scheduleAccountMediaCleanupRetries();
