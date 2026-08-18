import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the pg pool so the lock helper runs against a scriptable client. The
// mock records the query sequence and simulates the two coordination layers:
// the advisory lock and the durable per-bucket claim table (keyed on
// pass_name + bucket, where the bucket comes from a controllable clock).
const lockGranted = vi.hoisted(() => ({ value: true }));
const queries = vi.hoisted(() => ({ value: [] as string[] }));
const released = vi.hoisted(() => ({ value: 0 }));
const dbNowMs = vi.hoisted(() => ({ value: 1_000_000_000 }));
const claimedBuckets = vi.hoisted(() => ({ value: new Set<string>() }));
// Buckets claimed inside the currently open (uncommitted) transaction.
const txClaims = vi.hoisted(() => ({ value: [] as string[] }));

vi.mock('@workspace/db', () => ({
  pool: {
    // Used by ensureSchedulerRunsTable (CREATE TABLE IF NOT EXISTS).
    query: async (text: string) => {
      queries.value.push(text);
      return { rows: [], rowCount: 0 };
    },
    connect: async () => ({
      query: async (text: string, params?: unknown[]) => {
        queries.value.push(text);
        if (text.includes('pg_try_advisory_xact_lock')) {
          return { rows: [{ locked: lockGranted.value }], rowCount: 1 };
        }
        if (text.includes('INSERT INTO scheduler_pass_runs')) {
          const [passName, intervalMs] = params as [string, number];
          const bucket = Math.floor(dbNowMs.value / Number(intervalMs));
          const key = `${passName}:${bucket}`;
          if (claimedBuckets.value.has(key) || txClaims.value.includes(key)) {
            return { rows: [], rowCount: 0 };
          }
          txClaims.value.push(key);
          return { rows: [{ bucket }], rowCount: 1 };
        }
        if (text === 'COMMIT') {
          for (const key of txClaims.value) claimedBuckets.value.add(key);
          txClaims.value = [];
        }
        if (text === 'ROLLBACK') {
          txClaims.value = [];
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => {
        released.value += 1;
      },
    }),
  },
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  runWithSchedulerLock,
  ENGAGEMENT_SCAN_LOCK_KEY,
  PUSH_RETRY_DRAIN_LOCK_KEY,
} from '../lib/schedulerLock';

const INTERVAL_MS = 10 * 60 * 1000;

beforeEach(() => {
  lockGranted.value = true;
  queries.value = [];
  released.value = 0;
  dbNowMs.value = 1_000_000_000;
  claimedBuckets.value = new Set();
  txClaims.value = [];
});

describe('runWithSchedulerLock', () => {
  it('runs the pass and reports true when lock and bucket are won', async () => {
    const fn = vi.fn(async () => {});
    const ran = await runWithSchedulerLock(123, 'test-pass', INTERVAL_MS, fn);
    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    // BEGIN → try-lock → claim bucket → prune → (fn) → COMMIT.
    const client = queries.value.filter((q) => !q.includes('CREATE TABLE'));
    expect(client[0]).toBe('BEGIN');
    expect(client[1]).toContain('pg_try_advisory_xact_lock');
    expect(client[2]).toContain('INSERT INTO scheduler_pass_runs');
    expect(client.at(-1)).toBe('COMMIT');
    expect(released.value).toBe(1);
  });

  it('skips when another instance holds the lock (overlapping pass)', async () => {
    lockGranted.value = false;
    const fn = vi.fn(async () => {});
    const ran = await runWithSchedulerLock(123, 'test-pass', INTERVAL_MS, fn);
    expect(ran).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(queries.value.at(-1)).toBe('ROLLBACK');
    expect(released.value).toBe(1);
  });

  it('skips a phase-shifted replica whose timer fires later in the same bucket', async () => {
    // Replica A runs and commits its bucket claim.
    const fnA = vi.fn(async () => {});
    expect(await runWithSchedulerLock(123, 'test-pass', INTERVAL_MS, fnA)).toBe(true);

    // Replica B fires 3 minutes later — same 10-minute bucket, lock is free.
    dbNowMs.value += 3 * 60 * 1000;
    const fnB = vi.fn(async () => {});
    expect(await runWithSchedulerLock(123, 'test-pass', INTERVAL_MS, fnB)).toBe(false);
    expect(fnB).not.toHaveBeenCalled();
  });

  it('runs again once the next interval bucket begins', async () => {
    expect(await runWithSchedulerLock(123, 'test-pass', INTERVAL_MS, async () => {})).toBe(true);
    dbNowMs.value += INTERVAL_MS; // next bucket
    const fn = vi.fn(async () => {});
    expect(await runWithSchedulerLock(123, 'test-pass', INTERVAL_MS, fn)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('different pass names claim buckets independently', async () => {
    expect(await runWithSchedulerLock(123, 'pass-a', INTERVAL_MS, async () => {})).toBe(true);
    const fn = vi.fn(async () => {});
    expect(await runWithSchedulerLock(456, 'pass-b', INTERVAL_MS, fn)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rolls back the bucket claim when the pass throws, allowing a retry this tick', async () => {
    const boom = vi.fn(async () => {
      throw new Error('scan blew up');
    });
    await expect(runWithSchedulerLock(123, 'test-pass', INTERVAL_MS, boom)).rejects.toThrow(
      'scan blew up',
    );
    expect(queries.value.at(-1)).toBe('ROLLBACK');
    expect(released.value).toBe(1);

    // The failed claim did not persist — a retry in the same bucket runs.
    const retry = vi.fn(async () => {});
    expect(await runWithSchedulerLock(123, 'test-pass', INTERVAL_MS, retry)).toBe(true);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('uses distinct keys for the engagement and drain passes', () => {
    expect(ENGAGEMENT_SCAN_LOCK_KEY).not.toBe(PUSH_RETRY_DRAIN_LOCK_KEY);
  });
});
