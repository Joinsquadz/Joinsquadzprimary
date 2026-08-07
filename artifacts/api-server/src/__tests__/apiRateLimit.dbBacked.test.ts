/**
 * C3 regression: the API-wide rate limiter must use the DB-backed store
 * (rate_limits table) rather than an in-memory express-rate-limit store.
 *
 * Key invariant: rate-limit state is stored in the DB, not in the process heap.
 * A new middleware instance (simulating a server restart) still enforces the
 * limit because it reads from the same persistent DB row — unlike in-memory
 * rate limiting where a fresh instance starts with a zero counter.
 *
 * Tests:
 *   1. isKeyRateLimited — allows requests below the max.
 *   2. isKeyRateLimited — blocks requests above the max.
 *   3. isKeyRateLimited — degrades gracefully on DB error (allows request).
 *   4. dbApiRateLimiter middleware — returns 429 when DB count > max.
 *   5. Restart simulation: a NEW middleware instance (zero in-memory state)
 *      still returns 429 because the DB mock still reports count > max.
 *      An in-memory limiter would pass (its counter reset to 0 at startup).
 *   6. The middleware sets RateLimit-* headers on both allowed and blocked requests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

// ── DB mock ───────────────────────────────────────────────────────────────────
const mockDbExecute = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({
  db: {
    execute: mockDbExecute,
  },
}));

vi.mock("../lib/logger");

// Import AFTER mocks are hoisted.
import { isKeyRateLimited, dbApiRateLimiter } from "../lib/rateLimiter";

/** Build a minimal Express app that uses the given middleware.
 *
 * Note: `req.ip` is a getter-only property in Express; it is derived from
 * trust-proxy settings and cannot be set directly. For rate-limit tests the
 * exact IP value is irrelevant — the middleware falls back to "unknown" when
 * req.ip is undefined, and the mock always returns a deterministic count. */
function makeApp(limiter: ReturnType<typeof dbApiRateLimiter>) {
  const app = express();
  // trust proxy so req.ip is populated from X-Forwarded-For in tests
  app.set("trust proxy", 1);
  app.use("/api", limiter);
  app.get("/api/ping", (_req, res) => res.json({ ok: true }));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: well-behaved DB that returns count=1 (within any sane limit).
  mockDbExecute.mockResolvedValue({ rows: [{ count: 1 }] });
});

// ── isKeyRateLimited unit ─────────────────────────────────────────────────────
describe("isKeyRateLimited", () => {
  it("allows the request when DB count is below the max", async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ count: 10 }] });
    const { limited, count } = await isKeyRateLimited("test:1.2.3.4", 500);
    expect(limited).toBe(false);
    expect(count).toBe(10);
  });

  it("blocks the request when DB count exceeds the max", async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [{ count: 501 }] });
    const { limited, count } = await isKeyRateLimited("test:1.2.3.4", 500);
    expect(limited).toBe(true);
    expect(count).toBe(501);
  });

  it("allows the request and does not throw when the DB upsert fails", async () => {
    mockDbExecute.mockRejectedValueOnce(new Error("connection lost"));
    const { limited } = await isKeyRateLimited("test:1.2.3.4", 500);
    expect(limited).toBe(false);
  });
});

// ── dbApiRateLimiter middleware ───────────────────────────────────────────────
describe("dbApiRateLimiter middleware", () => {
  it("passes the request through when DB count is within the limit", async () => {
    mockDbExecute.mockResolvedValue({ rows: [{ count: 1 }] });
    const app = makeApp(dbApiRateLimiter());
    const res = await request(app).get("/api/ping");
    expect(res.status).toBe(200);
  });

  it("returns 429 when DB count exceeds the max", async () => {
    process.env.API_RATE_LIMIT_MAX = "500";
    mockDbExecute.mockResolvedValue({ rows: [{ count: 501 }] });
    const app = makeApp(dbApiRateLimiter());
    const res = await request(app).get("/api/ping");
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many requests/i);
  });

  it("sets RateLimit-Limit and RateLimit-Remaining headers", async () => {
    process.env.API_RATE_LIMIT_MAX = "500";
    mockDbExecute.mockResolvedValue({ rows: [{ count: 42 }] });
    const app = makeApp(dbApiRateLimiter());
    const res = await request(app).get("/api/ping");
    expect(res.headers["ratelimit-limit"]).toBeDefined();
    expect(Number(res.headers["ratelimit-remaining"])).toBeGreaterThanOrEqual(0);
  });

  it("allows /healthz and /health regardless of count (exempt paths)", async () => {
    mockDbExecute.mockResolvedValue({ rows: [{ count: 9999 }] });
    const app = express();
    app.set("trust proxy", 1);
    app.use(dbApiRateLimiter());
    app.get("/healthz", (_req, res) => res.json({ ok: true }));
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    // DB was never called — exempt path skips the limiter entirely.
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  // ── Restart simulation ─────────────────────────────────────────────────────
  it(
    "still enforces the limit after a simulated restart (new instance, DB count persists)",
    async () => {
      process.env.API_RATE_LIMIT_MAX = "500";
      // DB always reports count > max — simulates the persistent row in rate_limits.
      mockDbExecute.mockResolvedValue({ rows: [{ count: 501 }] });

      // First instance: hits the limit.
      const app1 = makeApp(dbApiRateLimiter());
      const res1 = await request(app1).get("/api/ping");
      expect(res1.status).toBe(429);

      // "Restart": create a BRAND NEW middleware instance (zero in-memory state).
      // An in-memory limiter would reset here and allow the request.
      // The DB-backed limiter reads the same persistent row → still blocked.
      const app2 = makeApp(dbApiRateLimiter());
      const res2 = await request(app2).get("/api/ping").set("X-Forwarded-For", "1.2.3.4");
      expect(res2.status).toBe(429);
    },
  );
});
