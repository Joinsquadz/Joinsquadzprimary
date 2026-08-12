// B4 — POST /iap/sync sets and clears is_squadz_plus idempotently.
// The route calls RevenueCat's subscriber API, reads the entitlement expiry,
// and calls storage.setSquadzPlus with the computed active flag. Repeating
// the call with the same state must not produce conflicting side effects.
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const setSquadzPlusMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "u1" }),
    upsertUser: vi.fn().mockResolvedValue({ id: "u1" }),
    setSquadzPlus: setSquadzPlusMock,
  },
}));

vi.mock("../lib/logger");

// Patch the global fetch used by the iap/sync route.
vi.stubGlobal("fetch", fetchMock);

import revenueCatRouter from "../routes/revenuecat";
import { makeTestApp } from "./helpers/makeTestApp";

const USER_ID = "user-rc-1";
const makeApp = () => makeTestApp(revenueCatRouter, { id: USER_ID });

const RC_ENTITLEMENT = "squadz_plus";

function rcSubscriberResponse(
  active: boolean,
  expiresInFuture = true,
  productId: string = "squadz_plus_standard_yearly",
) {
  const expires_date = active
    ? expiresInFuture
      ? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
      : new Date(Date.now() - 1000).toISOString()
    : null;
  return {
    subscriber: {
      entitlements: active
        // product_identifier is what the route derives the tier from; without it
        // an active subscriber syncs with a null tier.
        ? { [RC_ENTITLEMENT]: { expires_date, product_identifier: productId } }
        : {},
    },
  };
}

function mockRcOk(body: object) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // REVENUECAT_API_KEY must be present for the route to proceed past the 503 guard.
  process.env.REVENUECAT_API_KEY = "test-rc-key";
});

describe("B4 — POST /api/iap/sync — idempotent set/clear of is_squadz_plus", () => {
  it("sets isSquadzPlus true when the entitlement is active and returns it", async () => {
    mockRcOk(rcSubscriberResponse(true));
    const res = await request(makeApp()).post("/api/iap/sync");
    expect(res.status).toBe(200);
    expect(res.body.isSquadzPlus).toBe(true);
    expect(setSquadzPlusMock).toHaveBeenCalledWith(USER_ID, true, expect.any(Number), "standard");
  });

  it("calling /iap/sync again with active entitlement is idempotent (no flip)", async () => {
    mockRcOk(rcSubscriberResponse(true));
    await request(makeApp()).post("/api/iap/sync");
    mockRcOk(rcSubscriberResponse(true));
    const res = await request(makeApp()).post("/api/iap/sync");
    expect(res.status).toBe(200);
    expect(res.body.isSquadzPlus).toBe(true);
    // Both calls invoked setSquadzPlus(USER_ID, true) — no false in between.
    for (const [, flag] of setSquadzPlusMock.mock.calls as [string, boolean][]) {
      expect(flag).toBe(true);
    }
  });

  it("sets isSquadzPlus false when the entitlement is absent", async () => {
    mockRcOk(rcSubscriberResponse(false));
    const res = await request(makeApp()).post("/api/iap/sync");
    expect(res.status).toBe(200);
    expect(res.body.isSquadzPlus).toBe(false);
    expect(setSquadzPlusMock).toHaveBeenCalledWith(USER_ID, false, null, null);
  });

  it("sets isSquadzPlus false when the entitlement has expired", async () => {
    mockRcOk(rcSubscriberResponse(true, false)); // active flag true but expired date
    const res = await request(makeApp()).post("/api/iap/sync");
    expect(res.status).toBe(200);
    expect(res.body.isSquadzPlus).toBe(false);
    expect(setSquadzPlusMock).toHaveBeenCalledWith(USER_ID, false, expect.any(Number), null);
  });

  it("calling /iap/sync after entitlement expires clears the flag (idempotent)", async () => {
    // First call: active.
    mockRcOk(rcSubscriberResponse(true));
    await request(makeApp()).post("/api/iap/sync");
    // Second call: expired.
    mockRcOk(rcSubscriberResponse(false));
    const res = await request(makeApp()).post("/api/iap/sync");
    expect(res.status).toBe(200);
    expect(res.body.isSquadzPlus).toBe(false);
    expect(setSquadzPlusMock).toHaveBeenLastCalledWith(USER_ID, false, null, null);
  });

  it("returns 503 when REVENUECAT_API_KEY is not configured", async () => {
    delete process.env.REVENUECAT_API_KEY;
    const res = await request(makeApp()).post("/api/iap/sync");
    expect(res.status).toBe(503);
  });

  it("returns 502 when RevenueCat responds with a non-OK status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const res = await request(makeApp()).post("/api/iap/sync");
    expect(res.status).toBe(502);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeTestApp(revenueCatRouter)).post("/api/iap/sync");
    expect(res.status).toBe(401);
  });
});
