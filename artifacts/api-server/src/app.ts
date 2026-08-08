import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { dbApiRateLimiter, dbAuthRateLimiter } from "./lib/rateLimiter";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";
import wellKnownRouter from "./routes/wellKnown";
import { WebhookHandlers } from "./webhookHandlers";
import { logger } from "./lib/logger";
import { initMonitoring, setupSentryErrorHandler } from "./services/monitoring";
import { slowRequestMiddleware } from "./middleware/slowRequest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

initMonitoring();

const app: Express = express();

// Trust the first reverse proxy (Replit / load balancer) so req.ip
// reflects the real client IP via X-Forwarded-For.
app.set("trust proxy", 1);

// ── CORS ─────────────────────────────────────────────────────────────────────
// Mobile native clients send no Origin header and are always passed through.
// Browser clients must come from an explicitly allowed origin.
function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>(["https://joinsquadz.com"]);
  if (process.env.REPLIT_DEV_DOMAIN) {
    origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  }
  // Expo web preview is served from a SEPARATE domain that bypasses the shared
  // proxy, so its browser fetches hit this API cross-origin. Allowlist it or the
  // dev web preview gets a blank screen (every /api call fails CORS preflight).
  if (process.env.REPLIT_EXPO_DEV_DOMAIN) {
    origins.add(`https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`);
  }
  for (const d of (process.env.REPLIT_DOMAINS ?? "").split(",")) {
    const trimmed = d.trim();
    if (trimmed) origins.add(`https://${trimmed}`);
  }
  return origins;
}
const allowedOrigins = buildAllowedOrigins();

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
      logger.warn({ origin }, "CORS: blocked request from disallowed origin");
      callback(null, false);
    },
  }),
);

// ── Security headers ──────────────────────────────────────────────────────────
// CSP is disabled here — the API is consumed by native mobile clients and the
// web landing page handles its own CSP via the Vite build. Enable per-surface
// when needed.
app.use(helmet({ contentSecurityPolicy: false }));

// ── Response compression ──────────────────────────────────────────────────────
app.use(compression());

// ── Request logging ───────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── Stripe webhook ────────────────────────────────────────────────────────────
// Must be registered BEFORE express.json() — needs the raw Buffer body for
// signature verification.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res): Promise<void> => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature" });
      return;
    }
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      if (!Buffer.isBuffer(req.body)) {
        logger.error("STRIPE WEBHOOK ERROR: req.body is not a Buffer — express.json() ran first");
        res.status(500).json({ error: "Webhook processing error" });
        return;
      }
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err) {
      logger.error({ err }, "Webhook error");
      res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(authMiddleware);

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Protects all /api routes. Uses the DB-backed rate limiter (rate_limits table)
// so state survives server restarts and is consistent across multiple server
// instances. Tune the limit with API_RATE_LIMIT_MAX (default: 500 req / 15 min
// per user).
//
// Keyed by AUTHENTICATED USER when available (authMiddleware runs before this),
// falling back to IP for anonymous traffic. Keying by IP alone throttled whole
// friend groups at once: several members of the same squad on one Wi-Fi/NAT
// share an IP, and the app's SSE reconnects + safety polls made a 3-4 person
// group blow through the shared budget within minutes.
const apiRateLimiter = dbApiRateLimiter();

// Tighter limiter for authentication mutation routes (login, register, OTP,
// password reset). GET requests like /auth/me are excluded — they're called
// on every app launch and are not attack surfaces.
// Individual route handlers also apply per-endpoint in-memory counters for
// the most sensitive operations (register, login, forgot, reset).
// DB-backed so the 40-req/15-min cap is shared across all server instances.
const authWriteLimiter = dbAuthRateLimiter();

// /.well-known is mounted at the root (not /api) so iOS/Android association
// files are reachable at their canonical paths. The shared proxy routes
// /.well-known to this service (see artifact.toml).
app.use(wellKnownRouter);

app.use("/api/auth", authWriteLimiter);
app.use("/api", apiRateLimiter);
// Slow-request Sentry reporter — fires a warning-level event for any API
// request that takes longer than SLOW_REQUEST_THRESHOLD_MS (default: 1 s).
// Complements Sentry's automatic 20% performance sample with full coverage of
// latency outliers.
app.use("/api", slowRequestMiddleware);
app.use("/api", router);
setupSentryErrorHandler(app);

// ── Session table cleanup ─────────────────────────────────────────────────────
// Purge expired connect-pg-simple session rows every 6 hours to prevent
// unbounded table growth. Fire-and-forget; failures are logged and retried
// on the next interval.
const SESSION_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
setInterval(() => {
  db.execute(sql`DELETE FROM sessions WHERE expire < NOW()`)
    .then((r) => logger.info({ rowCount: (r as { rowCount?: number }).rowCount ?? 0 }, "[session-cleanup] purged expired sessions"))
    .catch((err: unknown) => logger.warn({ err }, "[session-cleanup] cleanup failed"));
}, SESSION_CLEANUP_INTERVAL_MS);

export default app;
