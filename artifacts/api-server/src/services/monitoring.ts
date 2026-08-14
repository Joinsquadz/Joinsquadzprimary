/**
 * Error tracking & performance monitoring — Sentry.
 * Set SENTRY_DSN to enable.  No-ops silently when absent.
 */
import * as Sentry from "@sentry/node";
import type { Express } from "express";
import { logger } from "../lib/logger";

let _initialised = false;

export function initMonitoring(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || _initialised) return;
  _initialised = true;

  if (Sentry.getClient()) {
    // Already initialised by instrument.ts via the --import ESM preload —
    // auto-instrumentation is active. Skip re-init to avoid overwriting config.
    logger.info("[services/monitoring] Sentry pre-initialised via instrument preload");
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
  });
  logger.info("[services/monitoring] Sentry initialised");
}

/**
 * Attach the Sentry Express error handler AFTER all routes.
 * No-ops if Sentry was not initialised.
 */
export function setupSentryErrorHandler(app: Express): void {
  if (!_initialised) return;
  Sentry.setupExpressErrorHandler(app);
}

// ── In-process error counter ─────────────────────────────────────────────────
// Keeps a rolling list of timestamps for every captured exception / error-level
// message within the current process lifetime.  The internal health endpoint
// reads this to show a recent error count without requiring the Sentry REST API.
// Capped at MAX_ERROR_TIMESTAMPS entries to keep memory usage bounded (each
// entry is a single number).
const MAX_ERROR_TIMESTAMPS = 1_000;
const _errorTimestamps: number[] = [];

function _recordError(): void {
  _errorTimestamps.push(Date.now());
  // Trim the oldest entries once we exceed the cap so the array never grows
  // past MAX_ERROR_TIMESTAMPS entries.
  if (_errorTimestamps.length > MAX_ERROR_TIMESTAMPS) {
    _errorTimestamps.splice(0, _errorTimestamps.length - MAX_ERROR_TIMESTAMPS);
  }
}

/**
 * Return the count of captured exceptions/error-level messages in the last
 * `windowMs` milliseconds (default: one hour) within this process.
 *
 * Note: this resets to zero when the process restarts.  The health endpoint
 * shows `uptime` alongside it so operators have the context to interpret it.
 */
export function getRecentErrorCount(windowMs = 60 * 60 * 1000): number {
  const since = Date.now() - windowMs;
  return _errorTimestamps.filter((t) => t >= since).length;
}

export function captureException(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  _recordError();
  Sentry.captureException(err, { extra: context });
}

export function captureMessage(
  message: string,
  level: "debug" | "info" | "warning" | "error" | "fatal" = "info",
  context?: Record<string, unknown>,
): void {
  if (level === "error" || level === "fatal") {
    _recordError();
  }
  Sentry.captureMessage(message, { level, extra: context });
}
