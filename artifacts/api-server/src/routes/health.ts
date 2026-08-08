import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getSmtpStatus } from "../emailService";
import { pool } from "@workspace/db";
import { getRecentErrorCount } from "../services/monitoring";
import { POOL_MAX, DB_MAX_CONNECTIONS } from "../lib/poolMonitor";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/healthz/smtp", (_req, res) => {
  const smtp = getSmtpStatus();
  const status = smtp.configured ? 200 : 503;
  res.status(status).json({
    configured: smtp.configured,
    host: smtp.host,
    port: smtp.port,
    user: smtp.user,
    from: smtp.from,
    ...(smtp.missing.length > 0 ? { missing: smtp.missing } : {}),
  });
});

// ── Internal health snapshot ──────────────────────────────────────────────────
// A single, auth-protected endpoint that returns a 10-second glance at the
// current server state:  pool usage, recent error count, and uptime.
//
// Protection: Bearer token in the Authorization header matched against the
// INTERNAL_API_TOKEN environment variable.  Set it via the Replit Secrets UI
// (or the environment-secrets skill) — choose a long random string.
//
// Example:
//   curl -H "Authorization: Bearer <token>" https://joinsquadz.com/api/internal/health
//
// The endpoint is deliberately cheap:
//   - Pool stats come from the Node.js pool object (no DB round-trip).
//   - Error count is an in-process counter incremented by captureException /
//     captureMessage("...", "error") — no Sentry API call.
//   - No auth middleware beyond the token check so it never contributes to
//     pool pressure.
//
// For Sentry Performance detail and full error history, use the Sentry dashboard.
// For Supabase quota/storage/compute alerts, configure them in the Supabase
// dashboard (see Part 4 of the monitoring setup doc).

function requireInternalToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const configured = process.env.INTERNAL_API_TOKEN;
  if (!configured) {
    res.status(401).json({
      error: "Internal API access not configured — set the INTERNAL_API_TOKEN secret",
    });
    return;
  }
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  if (token !== configured) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.get("/internal/health", requireInternalToken, (_req, res) => {
  // ── Pool stats (no DB query — instant) ────────────────────────────────────
  const poolTotal = pool.totalCount;
  const poolIdle = pool.idleCount;
  const poolWaiting = pool.waitingCount;
  const poolActive = poolTotal - poolIdle;
  const poolUsagePct =
    POOL_MAX > 0 ? Math.round((poolActive / POOL_MAX) * 1000) / 10 : 0;

  res.json({
    status: "ok",
    uptime: Math.round(process.uptime()),
    env: process.env.NODE_ENV ?? "development",
    timestamp: new Date().toISOString(),
    db: {
      poolTotal,
      poolIdle,
      poolActive,
      poolWaiting,
      poolMax: POOL_MAX,
      poolUsagePct,
      dbMaxConnections: DB_MAX_CONNECTIONS,
      note: "DB-side connection count available in pool-monitor logs (runs every 5 min)",
    },
    // In-process counter — resets on restart; show uptime alongside for context.
    recentErrors: getRecentErrorCount(60 * 60 * 1000),
    recentErrorsWindow: "1h",
    sentryNote: "Full error history and performance traces: Sentry dashboard",
  });
});

export default router;
