/**
 * Unit tests for GET /api/internal/health.
 *
 * Covers:
 *   1. Returns 401 when Authorization header is absent.
 *   2. Returns 401 when token is wrong.
 *   3. Returns 401 when INTERNAL_API_TOKEN env var is not set.
 *   4. Returns 200 with a well-formed snapshot when the correct token is supplied.
 *   5. Snapshot includes poolTotal, poolIdle, poolActive, poolWaiting, poolMax,
 *      poolUsagePct, uptime, recentErrors, env, timestamp.
 *   6. recentErrors reflects the value from getRecentErrorCount().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";

// ── Mocks — hoisted before any import ─────────────────────────────────────────
const mockGetRecentErrorCount = vi.hoisted(() => vi.fn(() => 0));

vi.mock("@workspace/db", () => ({
  pool: {
    totalCount: 10,
    idleCount: 7,
    waitingCount: 0,
  },
}));

// pool monitor exports — stable constants used for computations in the route
vi.mock("../lib/poolMonitor", () => ({
  POOL_MAX: 45,
  DB_MAX_CONNECTIONS: 90,
}));

vi.mock("../services/monitoring", () => ({
  getRecentErrorCount: mockGetRecentErrorCount,
  initMonitoring: vi.fn(),
  setupSentryErrorHandler: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("../emailService", () => ({
  getSmtpStatus: () => ({
    configured: false,
    host: undefined,
    port: undefined,
    user: undefined,
    from: undefined,
    missing: ["SMTP_USER", "SMTP_PASS"],
  }),
}));

vi.mock("@workspace/api-zod", () => ({
  HealthCheckResponse: { parse: (v: unknown) => v },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import AFTER mocks.
import healthRouter from "../routes/health";

const TEST_TOKEN = "test-internal-token-abc123";

function makeApp(token?: string) {
  // Set the env var BEFORE constructing the app so requireInternalToken reads it.
  if (token !== undefined) {
    process.env.INTERNAL_API_TOKEN = token;
  } else {
    delete process.env.INTERNAL_API_TOKEN;
  }
  const app = express();
  app.use("/api", healthRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRecentErrorCount.mockReturnValue(0);
});

afterEach(() => {
  delete process.env.INTERNAL_API_TOKEN;
});

// ── Auth guard ────────────────────────────────────────────────────────────────

describe("GET /api/internal/health — auth guard", () => {
  it("returns 401 when no Authorization header is provided", async () => {
    const app = makeApp(TEST_TOKEN);
    const res = await request(app).get("/api/internal/health");
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header has the wrong token", async () => {
    const app = makeApp(TEST_TOKEN);
    const res = await request(app)
      .get("/api/internal/health")
      .set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });

  it("returns 401 when INTERNAL_API_TOKEN env var is not set", async () => {
    const app = makeApp(undefined); // no token configured
    const res = await request(app)
      .get("/api/internal/health")
      .set("Authorization", `Bearer ${TEST_TOKEN}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("INTERNAL_API_TOKEN");
  });
});

// ── Successful response ───────────────────────────────────────────────────────

describe("GET /api/internal/health — snapshot", () => {
  it("returns 200 with a well-formed snapshot when the correct token is supplied", async () => {
    const app = makeApp(TEST_TOKEN);
    const res = await request(app)
      .get("/api/internal/health")
      .set("Authorization", `Bearer ${TEST_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("snapshot includes db pool fields with correct computed values", async () => {
    const app = makeApp(TEST_TOKEN);
    const res = await request(app)
      .get("/api/internal/health")
      .set("Authorization", `Bearer ${TEST_TOKEN}`);
    expect(res.body.db).toMatchObject({
      poolTotal: 10,
      poolIdle: 7,
      poolActive: 3, // 10 - 7
      poolWaiting: 0,
      poolMax: 45,
    });
    expect(typeof res.body.db.poolUsagePct).toBe("number");
  });

  it("snapshot includes uptime, env, and timestamp", async () => {
    const app = makeApp(TEST_TOKEN);
    const res = await request(app)
      .get("/api/internal/health")
      .set("Authorization", `Bearer ${TEST_TOKEN}`);
    expect(typeof res.body.uptime).toBe("number");
    expect(res.body).toHaveProperty("env");
    expect(res.body).toHaveProperty("timestamp");
    // timestamp should be a valid ISO 8601 string
    expect(() => new Date(res.body.timestamp)).not.toThrow();
  });

  it("recentErrors reflects the value from getRecentErrorCount()", async () => {
    mockGetRecentErrorCount.mockReturnValue(7);
    const app = makeApp(TEST_TOKEN);
    const res = await request(app)
      .get("/api/internal/health")
      .set("Authorization", `Bearer ${TEST_TOKEN}`);
    expect(res.body.recentErrors).toBe(7);
    expect(mockGetRecentErrorCount).toHaveBeenCalledWith(60 * 60 * 1000);
  });

  it("includes a recentErrorsWindow label", async () => {
    const app = makeApp(TEST_TOKEN);
    const res = await request(app)
      .get("/api/internal/health")
      .set("Authorization", `Bearer ${TEST_TOKEN}`);
    expect(res.body.recentErrorsWindow).toBe("1h");
  });
});
