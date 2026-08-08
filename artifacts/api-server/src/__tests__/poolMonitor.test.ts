/**
 * Unit tests for the DB connection-pool health scanner (poolMonitor.ts).
 *
 * Covers:
 *   1. Logs a snapshot at INFO level on every run.
 *   2. No Sentry warning when pool usage is below the 80% threshold.
 *   3. Sentry WARNING when pool active connections ≥ 80% of POOL_MAX.
 *   4. Sentry WARNING (queued) when waitingCount > 0 (pool fully saturated).
 *   5. Sentry WARNING when DB-side connections ≥ 80% of DB_MAX_CONNECTIONS.
 *   6. Gracefully handles pg_stat_activity query errors without throwing.
 *   7. Returns a PoolSnapshot with correct computed fields.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks — vi.hoisted so factories can reference them ────────────────────────
// mockPool MUST be hoisted — vi.mock factories are hoisted to the top of the
// file, so any variable referenced inside must also be hoisted or it lands in
// the temporal dead zone when the factory executes.
const mockPool = vi.hoisted(() => ({
  totalCount: 0,
  idleCount: 0,
  waitingCount: 0,
  query: vi.fn(),
}));

const mockCaptureMessage = vi.hoisted(() => vi.fn());
const mockLoggerInfo = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => ({ pool: mockPool }));

vi.mock("../services/monitoring", () => ({
  captureMessage: mockCaptureMessage,
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import AFTER mocks are registered.
import { runPoolHealthCheck, POOL_MAX, DB_MAX_CONNECTIONS } from "../lib/poolMonitor";

// Default: 5 active connections — well below 80% of POOL_MAX (45).
beforeEach(() => {
  vi.clearAllMocks();
  mockPool.totalCount = 5;
  mockPool.idleCount = 5;
  mockPool.waitingCount = 0;
  // Default: 5 DB-side connections — well below 80% of DB_MAX_CONNECTIONS (90).
  mockPool.query.mockResolvedValue({ rows: [{ count: 5 }] });
});

describe("runPoolHealthCheck", () => {
  it("logs a pool snapshot at INFO level on every run", async () => {
    await runPoolHealthCheck();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ poolMax: POOL_MAX }),
      expect.stringContaining("[pool-monitor]"),
    );
  });

  it("returns a PoolSnapshot with correct computed active count", async () => {
    mockPool.totalCount = 12;
    mockPool.idleCount = 4;
    const snap = await runPoolHealthCheck();
    expect(snap.poolActive).toBe(8); // 12 - 4
    expect(snap.poolTotal).toBe(12);
    expect(snap.poolIdle).toBe(4);
    expect(snap.poolWaiting).toBe(0);
    expect(snap.poolMax).toBe(POOL_MAX);
  });

  it("does NOT emit a Sentry warning when pool usage is below 80%", async () => {
    // 35 / 45 = 77.8% — just below the threshold
    mockPool.totalCount = 35;
    mockPool.idleCount = 0;
    await runPoolHealthCheck();
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("emits a Sentry WARNING when pool active connections reach 80% of POOL_MAX", async () => {
    // 37 / 45 ≈ 82.2% — above threshold
    mockPool.totalCount = 37;
    mockPool.idleCount = 0;
    await runPoolHealthCheck();
    expect(mockCaptureMessage).toHaveBeenCalledOnce();
    const [msg, level] = mockCaptureMessage.mock.calls[0];
    expect(level).toBe("warning");
    expect(msg).toContain("WARNING");
    expect(msg).toContain("capacity");
  });

  it("emits a Sentry WARNING (queued) when requests are waiting for a connection", async () => {
    // waitingCount > 0 means the pool is fully saturated
    mockPool.totalCount = POOL_MAX;
    mockPool.idleCount = 0;
    mockPool.waitingCount = 3;
    await runPoolHealthCheck();
    expect(mockCaptureMessage).toHaveBeenCalledOnce();
    const [msg, level] = mockCaptureMessage.mock.calls[0];
    expect(level).toBe("warning");
    expect(msg).toContain("queued");
    expect(msg).toContain("3");
  });

  it("emits a Sentry WARNING when DB-side connections reach 80% of DB_MAX_CONNECTIONS", async () => {
    // 73 / 90 ≈ 81.1% — above threshold; pool itself is fine
    mockPool.query.mockResolvedValue({ rows: [{ count: 73 }] });
    await runPoolHealthCheck();
    expect(mockCaptureMessage).toHaveBeenCalledOnce();
    const [msg, level] = mockCaptureMessage.mock.calls[0];
    expect(level).toBe("warning");
    expect(msg).toContain("DB at");
    expect(msg).toContain(`${DB_MAX_CONNECTIONS}`);
  });

  it("does not throw and omits DB warning when pg_stat_activity fails", async () => {
    mockPool.query.mockRejectedValue(new Error("pg_stat_activity denied"));
    await expect(runPoolHealthCheck()).resolves.not.toThrow();
    // No DB-level Sentry warning when the query itself failed
    const dbWarningCalls = mockCaptureMessage.mock.calls.filter(([msg]) =>
      String(msg).includes("DB at"),
    );
    expect(dbWarningCalls).toHaveLength(0);
  });

  it("includes a dbQueryError field in the snapshot when the query fails", async () => {
    mockPool.query.mockRejectedValue(new Error("connection refused"));
    const snap = await runPoolHealthCheck();
    expect(snap.dbQueryError).toContain("connection refused");
  });

  it("emits both a pool warning and a DB warning when both thresholds are crossed", async () => {
    mockPool.totalCount = 40; // 40/45 ≈ 88.9%
    mockPool.idleCount = 0;
    mockPool.query.mockResolvedValue({ rows: [{ count: 74 }] }); // 74/90 ≈ 82.2%
    await runPoolHealthCheck();
    expect(mockCaptureMessage).toHaveBeenCalledTimes(2);
  });
});
