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

export function captureException(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  Sentry.captureException(err, { extra: context });
}

export function captureMessage(
  message: string,
  level: "debug" | "info" | "warning" | "error" | "fatal" = "info",
): void {
  Sentry.captureMessage(message, level);
}
