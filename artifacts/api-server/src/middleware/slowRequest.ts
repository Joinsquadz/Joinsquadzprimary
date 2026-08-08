/**
 * Slow-request Sentry reporter.
 *
 * Tracks wall-clock time for every API request.  When a response takes longer
 * than SLOW_REQUEST_THRESHOLD_MS (default: 1 second, override via env) a
 * Sentry WARNING is emitted so slow-request trends are visible over time rather
 * than only discoverable by manually running a load test.
 *
 * This complements Sentry's automatic performance tracing (tracesSampleRate:
 * 0.2 in production), which samples 20% of all requests.  The 80% that are
 * not sampled will still generate a Sentry warning if they are slow, giving
 * full coverage for latency outliers regardless of the sample rate.
 *
 * Mount in app.ts after authMiddleware and before the route handlers:
 *   app.use("/api", slowRequestMiddleware);
 *   app.use("/api", router);
 */
import { type Request, type Response, type NextFunction } from "express";
import { captureMessage } from "../services/monitoring";
import { logger } from "../lib/logger";

/**
 * Requests that take longer than this threshold are reported to Sentry as a
 * warning.  Default: 1000 ms (1 second).  Override via SLOW_REQUEST_THRESHOLD_MS.
 */
export const SLOW_REQUEST_THRESHOLD_MS = Number(
  process.env.SLOW_REQUEST_THRESHOLD_MS ?? "1000",
);

export function slowRequestMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    if (durationMs < SLOW_REQUEST_THRESHOLD_MS) return;

    // Prefer the matched router path (e.g. "/squads/:id") over the raw URL so
    // high-cardinality IDs don't fragment Sentry grouping.
    const route = req.route?.path ?? req.path;
    const msg =
      `Slow request: ${req.method} ${route} took ${durationMs}ms` +
      ` (status ${res.statusCode})`;

    logger.warn(
      { method: req.method, route, durationMs, statusCode: res.statusCode },
      "[slow-request] " + msg,
    );
    captureMessage(msg, "warning");
  });

  next();
}
