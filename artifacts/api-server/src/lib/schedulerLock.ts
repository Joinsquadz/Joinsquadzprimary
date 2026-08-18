import { pool } from '@workspace/db';
import { logger } from './logger';

// Cross-instance scheduler coordination. Every API process starts the same
// interval timers, so without central coordination each replica would run the
// full scan pass on the same cadence — and any future notification producer
// that forgets the per-event claim pattern would double-send immediately.
//
// Two mechanisms combine to make "one pass per tick, app-wide" structural:
//
//  1. A transaction-scoped advisory lock (`pg_try_advisory_xact_lock`) held
//     for the duration of the pass serializes OVERLAPPING executions.
//  2. A durable per-time-bucket claim row (INSERT ... ON CONFLICT DO NOTHING,
//     committed with the pass) stops PHASE-SHIFTED replicas: replica B's
//     timer firing seconds after replica A finished would win the advisory
//     lock, but finds the current bucket already claimed and skips.
//
// The bucket is computed from the DATABASE clock (one shared clock, immune to
// replica clock skew): floor(epoch_ms / intervalMs). The per-event atomic
// claims inside each scan remain as defence in depth.
//
// Keys are arbitrary fixed bigints; they must not collide with the other
// advisory-lock keys in this codebase (grep for pg_advisory before adding).
export const ENGAGEMENT_SCAN_LOCK_KEY = 1_952_004_226;
export const PUSH_RETRY_DRAIN_LOCK_KEY = 1_952_004_227;

// Claim rows older than this are pruned opportunistically on each claim.
const CLAIM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

let tableReady = false;

async function ensureSchedulerRunsTable(): Promise<void> {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduler_pass_runs (
      pass_name TEXT NOT NULL,
      bucket BIGINT NOT NULL,
      ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (pass_name, bucket)
    )
  `);
  tableReady = true;
}

/**
 * Run `fn` at most once per `intervalMs` time bucket across ALL instances.
 *
 * Inside one transaction: win the advisory lock (else another instance is
 * mid-pass right now — skip), claim the current bucket row (else some
 * instance already ran this tick — skip), run `fn`, then COMMIT so the bucket
 * claim persists and the lock releases. If `fn` throws, the transaction rolls
 * back, releasing both the lock and the bucket claim so the pass can be
 * retried this tick — safe because every scan is idempotent via per-event
 * claims.
 *
 * Transaction scoping means a crashed or OOM-killed process can never leave
 * the lock stranded or a bucket claimed-but-unrun: Postgres discards both
 * when the session dies.
 *
 * Behaviour on a single instance is unchanged: the lock is always free and
 * each tick lands in a fresh bucket, so the pass always runs.
 *
 * Returns true when the pass ran, false when it was skipped.
 */
export async function runWithSchedulerLock(
  lockKey: number,
  label: string,
  intervalMs: number,
  fn: () => Promise<void>,
): Promise<boolean> {
  await ensureSchedulerRunsTable();
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const lockResult = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1) AS locked',
      [lockKey],
    );
    if (!lockResult.rows[0]?.locked) {
      logger.info({ label }, 'Scheduled pass skipped: another instance is running it right now');
      return false;
    }

    // Claim this interval's bucket. Uses the DB clock so all replicas agree
    // on bucket boundaries regardless of local clock skew or timer phase.
    const claim = await client.query(
      `INSERT INTO scheduler_pass_runs (pass_name, bucket)
       SELECT $1, FLOOR(EXTRACT(EPOCH FROM now()) * 1000 / $2::bigint)::bigint
       ON CONFLICT (pass_name, bucket) DO NOTHING
       RETURNING bucket`,
      [label, intervalMs],
    );
    if (claim.rowCount === 0) {
      logger.info({ label }, 'Scheduled pass skipped: this interval already ran on another instance');
      return false;
    }

    // Opportunistic prune so the claims table never grows unbounded.
    await client.query(
      `DELETE FROM scheduler_pass_runs
       WHERE pass_name = $1 AND ran_at < now() - ($2::bigint * INTERVAL '1 millisecond')`,
      [label, CLAIM_RETENTION_MS],
    );

    await fn();

    // COMMIT persists the bucket claim (stopping phase-shifted replicas from
    // re-running this tick) and releases the advisory lock.
    await client.query('COMMIT');
    committed = true;
    return true;
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}
