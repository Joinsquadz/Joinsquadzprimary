/**
 * Lightweight DB connection-pool health scanner.
 *
 * Runs on a fixed interval (default: every 5 minutes) and:
 *  1. Reads the Node.js pool object's in-process stats — totalCount, idleCount,
 *     waitingCount — at zero cost (no DB query, no network).
 *  2. Issues one lightweight pg_stat_activity query for the DB-side connection
 *     count (all connections from the current Postgres user, giving a
 *     cross-instance view when autoscale is running multiple API instances).
 *  3. Always logs a snapshot at INFO level for historical reference.
 *  4. Emits a Sentry WARNING (not error) when either:
 *       - pool active connections cross POOL_WARNING_THRESHOLD (80% of
 *         DB_POOL_MAX); or
 *       - any requests are queued waiting for a free connection
 *         (waitingCount > 0, meaning the pool is fully saturated); or
 *       - DB-side connections cross 80% of DB_MAX_CONNECTIONS.
 *
 * Warning-level Sentry events appear in the Issues list but don't page on-call
 * without an alert rule — they're visible as a trend without alert fatigue.
 *
 * Register from index.ts alongside the engagement scanners:
 *   import { runPoolHealthCheck, POOL_MONITOR_INTERVAL_MS } from './lib/poolMonitor';
 *   setInterval(() => runPoolHealthCheck().catch(...), POOL_MONITOR_INTERVAL_MS).unref();
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { captureMessage } from "../services/monitoring";

/** Run the check every 5 minutes — cheap enough to run continuously. */
export const POOL_MONITOR_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Supabase Small: 90 max_connections total; ~3 superuser reserved → ~87
 * available. Override via DB_MAX_CONNECTIONS if on a different tier.
 */
export const DB_MAX_CONNECTIONS = Number(
  process.env.DB_MAX_CONNECTIONS ?? "90",
);

/** Our application-pool ceiling (matched by connection.ts). */
export const POOL_MAX = Number(process.env.DB_POOL_MAX ?? "45");

/** Warn when active usage crosses this fraction of the ceiling. */
const POOL_WARNING_THRESHOLD = 0.8;

export interface PoolSnapshot {
  poolTotal: number;
  poolIdle: number;
  poolActive: number;
  poolWaiting: number;
  poolMax: number;
  poolUsagePct: number;
  dbConnections: number;
  dbMaxConnections: number;
  dbUsagePct: number;
  dbQueryError?: string;
}

/**
 * Take a single pool health snapshot, log it, and send Sentry warnings if any
 * threshold is crossed.  Never throws — errors are logged and swallowed so a
 * transient DB hiccup doesn't prevent the next check.
 */
export async function runPoolHealthCheck(): Promise<PoolSnapshot> {
  // ── Node.js pool object stats (zero cost — no DB round-trip) ───────────────
  const poolTotal = pool.totalCount; // open connections (idle + checked-out)
  const poolIdle = pool.idleCount; // idle, waiting for a query
  const poolWaiting = pool.waitingCount; // requests queued for a free conn
  const poolActive = poolTotal - poolIdle;
  const poolUsagePct =
    POOL_MAX > 0
      ? Math.round((poolActive / POOL_MAX) * 1000) / 10
      : 0;

  // ── DB-side connection count via pg_stat_activity ──────────────────────────
  // A single cheap query; counts all connections from current_user so it
  // gives a cross-instance picture when autoscale runs multiple API processes.
  let dbConnections = 0;
  let dbQueryError: string | undefined;
  try {
    const result = await pool.query(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE usename = current_user",
    );
    dbConnections =
      (result.rows[0] as { count: number } | undefined)?.count ?? 0;
  } catch (err) {
    dbQueryError = String(err);
  }
  const dbUsagePct =
    DB_MAX_CONNECTIONS > 0
      ? Math.round((dbConnections / DB_MAX_CONNECTIONS) * 1000) / 10
      : 0;

  const snapshot: PoolSnapshot = {
    poolTotal,
    poolIdle,
    poolActive,
    poolWaiting,
    poolMax: POOL_MAX,
    poolUsagePct,
    dbConnections,
    dbMaxConnections: DB_MAX_CONNECTIONS,
    dbUsagePct,
    ...(dbQueryError ? { dbQueryError } : {}),
  };

  logger.info(snapshot, "[pool-monitor] connection pool snapshot");

  // ── Threshold warnings ─────────────────────────────────────────────────────
  if (poolWaiting > 0) {
    const msg =
      `[pool-monitor] WARNING: ${poolWaiting} request(s) queued waiting for a DB connection` +
      ` (pool fully saturated at ${poolTotal}/${POOL_MAX})`;
    logger.warn(snapshot, msg);
    captureMessage(msg, "warning");
  } else if (poolUsagePct >= POOL_WARNING_THRESHOLD * 100) {
    const msg =
      `[pool-monitor] WARNING: pool at ${poolUsagePct}% capacity` +
      ` (${poolActive} active / ${POOL_MAX} max)`;
    logger.warn(snapshot, msg);
    captureMessage(msg, "warning");
  }

  if (!dbQueryError && dbUsagePct >= POOL_WARNING_THRESHOLD * 100) {
    const msg =
      `[pool-monitor] WARNING: DB at ${dbUsagePct}% of max_connections` +
      ` (${dbConnections}/${DB_MAX_CONNECTIONS} connections from current user)`;
    logger.warn(snapshot, msg);
    captureMessage(msg, "warning");
  }

  return snapshot;
}
