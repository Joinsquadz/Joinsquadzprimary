/**
 * Unit tests for slowRequestMiddleware.
 *
 * Uses vi.spyOn(Date, 'now') to simulate elapsed time — no real delays
 * in the test suite.
 *
 * Covers:
 *   1. Fast requests (below threshold) do NOT emit a Sentry warning.
 *   2. Slow requests (at or above threshold) emit a Sentry WARNING.
 *   3. The warning message includes method, route path, duration, and status.
 *   4. Uses req.route.path (parametric) when available, falls back to req.path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express, { type Router } from "express";

// ── Mocks ─────────────────────────────────────────────────────────────────────
const mockCaptureMessage = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());

vi.mock("../services/monitoring", () => ({
  captureMessage: mockCaptureMessage,
}));

vi.mock("../lib/logger", () => ({
  logger: {
    warn: mockLoggerWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import AFTER mocks.
import { slowRequestMiddleware, SLOW_REQUEST_THRESHOLD_MS } from "../middleware/slowRequest";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal Express app with the middleware applied. */
function makeApp(routerSetup?: (r: Router) => void) {
  const app = express();
  app.use(slowRequestMiddleware);
  const r = express.Router();
  if (routerSetup) {
    routerSetup(r);
  } else {
    r.get("/squads", (_req, res) => res.json({ squads: [] }));
  }
  app.use("/api", r);
  return app;
}

/** Simulate elapsed time via Date.now spy: first call → startedAt, second → finish. */
function fakeElapsed(elapsedMs: number) {
  const start = 10_000;
  return vi.spyOn(Date, "now")
    .mockReturnValueOnce(start)        // recorded when middleware runs
    .mockReturnValueOnce(start + elapsedMs); // read in the 'finish' handler
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("slowRequestMiddleware", () => {
  it("does NOT emit a Sentry warning for requests below the threshold", async () => {
    fakeElapsed(SLOW_REQUEST_THRESHOLD_MS - 1);
    const app = makeApp();
    await request(app).get("/api/squads").expect(200);
    // Give the finish handler a chance to run.
    await new Promise((r) => setTimeout(r, 5));
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("emits a Sentry WARNING for requests at exactly the threshold", async () => {
    fakeElapsed(SLOW_REQUEST_THRESHOLD_MS);
    const app = makeApp();
    await request(app).get("/api/squads").expect(200);
    await new Promise((r) => setTimeout(r, 5));
    expect(mockCaptureMessage).toHaveBeenCalledOnce();
    expect(mockCaptureMessage.mock.calls[0][1]).toBe("warning");
  });

  it("emits a Sentry WARNING for requests above the threshold", async () => {
    fakeElapsed(SLOW_REQUEST_THRESHOLD_MS + 500);
    const app = makeApp();
    await request(app).get("/api/squads").expect(200);
    await new Promise((r) => setTimeout(r, 5));
    expect(mockCaptureMessage).toHaveBeenCalledOnce();
    const [msg, level] = mockCaptureMessage.mock.calls[0];
    expect(level).toBe("warning");
    expect(msg).toContain("Slow request");
  });

  it("includes method, path, duration and status code in the warning message", async () => {
    const elapsed = SLOW_REQUEST_THRESHOLD_MS + 200;
    fakeElapsed(elapsed);
    const app = makeApp();
    await request(app).get("/api/squads").expect(200);
    await new Promise((r) => setTimeout(r, 5));
    const [msg] = mockCaptureMessage.mock.calls[0];
    expect(msg).toContain("GET");
    expect(msg).toContain("/squads");
    expect(msg).toContain(`${elapsed}ms`);
    expect(msg).toContain("200");
  });

  it("uses req.route.path (parametric) when available instead of raw URL", async () => {
    fakeElapsed(SLOW_REQUEST_THRESHOLD_MS + 100);
    const app = makeApp((r) => {
      r.get("/squads/:id", (_req, res) => res.json({ id: "abc" }));
    });
    await request(app).get("/api/squads/abc-123").expect(200);
    await new Promise((r) => setTimeout(r, 5));
    const [msg] = mockCaptureMessage.mock.calls[0];
    // Should contain the parameterised path, not the raw ID
    expect(msg).toContain("/squads/:id");
    expect(msg).not.toContain("abc-123");
  });

  it("also logs a warn via the logger", async () => {
    fakeElapsed(SLOW_REQUEST_THRESHOLD_MS + 100);
    const app = makeApp();
    await request(app).get("/api/squads").expect(200);
    await new Promise((r) => setTimeout(r, 5));
    expect(mockLoggerWarn).toHaveBeenCalled();
  });
});
