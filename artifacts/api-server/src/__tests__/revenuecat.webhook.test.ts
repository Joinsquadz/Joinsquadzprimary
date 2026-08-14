import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";

// RevenueCat server-to-server webhook: the ONLY path that flips a user's Squadz+
// status and consumes founding spots (mobile IAP is the sole purchase surface).
// Verifies auth gating, entitlement grant/revoke into the unified
// users.is_squadz_plus flag, and founding-spot idempotency (ledger keyed by
// rc:<original_transaction_id>). The per-key idempotency of redeemFoundingSpot
// itself is proven against a real Postgres in
// __tests__/concurrency/realDb.concurrency.test.ts.

const hoisted = vi.hoisted(() => ({
  getUser: vi.fn(),
  setSquadzPlus: vi.fn().mockResolvedValue(undefined),
  // Webhook entitlement writes go through the period-guarded variant so that
  // unordered delivery can't apply a stale event; see revenuecat.outOfOrder.
  setSquadzPlusForPeriod: vi.fn().mockResolvedValue({ applied: true }),
  redeemFoundingSpot: vi.fn().mockResolvedValue(true),
  captureMessage: vi.fn(),
}));

vi.mock("../storage", () => ({
  storage: {
    getUser: hoisted.getUser,
    setSquadzPlus: hoisted.setSquadzPlus,
    setSquadzPlusForPeriod: hoisted.setSquadzPlusForPeriod,
  },
}));

vi.mock("../lib/founding", () => ({ redeemFoundingSpot: hoisted.redeemFoundingSpot }));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../services/monitoring", () => ({ captureMessage: hoisted.captureMessage }));

import revenuecatRouter from "../routes/revenuecat";
import { makeTestApp } from "./helpers/makeTestApp";

const AUTH = "Bearer webhook-secret";
const PREV_AUTH = process.env.REVENUECAT_WEBHOOK_AUTH;

const app = () => makeTestApp(revenuecatRouter);

const post = (body: unknown, auth: string | null = AUTH) => {
  let req = request(app()).post("/api/revenuecat/webhook");
  if (auth) req = req.set("authorization", auth);
  return req.send(body as object);
};

const FOUNDING = "com.squadz.app.squadzplus.founding.annual";
const STANDARD = "com.squadz.app.squadzplus.standard.annual";

const USER = { id: "u1", email: "u1@example.test" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REVENUECAT_WEBHOOK_AUTH = AUTH;
  hoisted.getUser.mockResolvedValue(USER as never);
  hoisted.setSquadzPlus.mockResolvedValue(undefined);
  hoisted.setSquadzPlusForPeriod.mockResolvedValue({ applied: true });
  hoisted.redeemFoundingSpot.mockResolvedValue(true);
});

afterAll(() => {
  if (PREV_AUTH === undefined) delete process.env.REVENUECAT_WEBHOOK_AUTH;
  else process.env.REVENUECAT_WEBHOOK_AUTH = PREV_AUTH;
});

describe("POST /api/revenuecat/webhook — auth gating", () => {
  it("503s when the shared secret is not configured", async () => {
    delete process.env.REVENUECAT_WEBHOOK_AUTH;
    const res = await post(
      { event: { type: "INITIAL_PURCHASE", app_user_id: "u1", product_id: STANDARD } },
      null,
    );
    expect(res.status).toBe(503);
    expect(hoisted.setSquadzPlusForPeriod).not.toHaveBeenCalled();
  });

  it("401s on a wrong Authorization header", async () => {
    const res = await post(
      { event: { type: "INITIAL_PURCHASE", app_user_id: "u1", product_id: STANDARD } },
      "Bearer nope",
    );
    expect(res.status).toBe(401);
    expect(hoisted.setSquadzPlusForPeriod).not.toHaveBeenCalled();
  });

  it("400s on a body with no event", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });

  it("acks (200) an event without an app_user_id and does nothing", async () => {
    const res = await post({ event: { type: "INITIAL_PURCHASE", product_id: STANDARD } });
    expect(res.status).toBe(200);
    expect(hoisted.setSquadzPlusForPeriod).not.toHaveBeenCalled();
    expect(hoisted.redeemFoundingSpot).not.toHaveBeenCalled();
  });
});

describe("POST /api/revenuecat/webhook — entitlement grant/revoke", () => {
  it("grants Squadz+ on INITIAL_PURCHASE (standard)", async () => {
    const res = await post({
      event: {
        type: "INITIAL_PURCHASE",
        app_user_id: "u1",
        product_id: STANDARD,
        entitlement_ids: ["squadz_plus"],
      },
    });
    expect(res.status).toBe(200);
    expect(hoisted.setSquadzPlusForPeriod).toHaveBeenCalledWith("u1", true, null, "standard");
    // Standard tier never consumes a founding spot.
    expect(hoisted.redeemFoundingSpot).not.toHaveBeenCalled();
  });

  it("revokes Squadz+ on EXPIRATION", async () => {
    const res = await post({
      event: {
        type: "EXPIRATION",
        app_user_id: "u1",
        product_id: STANDARD,
        entitlement_ids: ["squadz_plus"],
      },
    });
    expect(res.status).toBe(200);
    expect(hoisted.setSquadzPlusForPeriod).toHaveBeenCalledWith("u1", false, null, null);
  });

  it("does not touch entitlement for CANCELLATION (access continues until expiry)", async () => {
    const res = await post({
      event: {
        type: "CANCELLATION",
        app_user_id: "u1",
        product_id: STANDARD,
        entitlement_ids: ["squadz_plus"],
      },
    });
    expect(res.status).toBe(200);
    expect(hoisted.setSquadzPlusForPeriod).not.toHaveBeenCalled();
  });

  it("acks (200) without writing for an unknown user", async () => {
    hoisted.getUser.mockResolvedValue(null as never);
    const res = await post({
      event: {
        type: "INITIAL_PURCHASE",
        app_user_id: "ghost",
        product_id: STANDARD,
        entitlement_ids: ["squadz_plus"],
      },
    });
    expect(res.status).toBe(200);
    expect(hoisted.setSquadzPlusForPeriod).not.toHaveBeenCalled();
  });

  it("keeps a stored founding tier when a RENEWAL reports the standard product and emits telemetry", async () => {
    hoisted.getUser.mockResolvedValue({ ...USER, squadzPlusTier: "founding" } as never);
    const res = await post({
      event: {
        type: "RENEWAL",
        app_user_id: "u1",
        product_id: STANDARD,
        entitlement_ids: ["squadz_plus"],
      },
    });

    expect(res.status).toBe(200);
    expect(hoisted.setSquadzPlusForPeriod).toHaveBeenCalledWith("u1", true, null, null);
    expect(hoisted.captureMessage).toHaveBeenCalledWith(
      "Blocked attempted founding tier downgrade",
      "warning",
      {
        userId: "u1",
        productIdentifier: STANDARD,
        eventType: "RENEWAL",
        source: "webhook",
      },
    );
  });

  it("allows a stored standard tier to upgrade to founding", async () => {
    hoisted.getUser.mockResolvedValue({ ...USER, squadzPlusTier: "standard" } as never);
    const res = await post({
      event: {
        type: "PRODUCT_CHANGE",
        app_user_id: "u1",
        product_id: FOUNDING,
        entitlement_ids: ["squadz_plus"],
      },
    });

    expect(res.status).toBe(200);
    expect(hoisted.setSquadzPlusForPeriod).toHaveBeenCalledWith("u1", true, null, "founding");
  });

  it("does not clear a stored founding tier on revocation", async () => {
    hoisted.getUser.mockResolvedValue({ ...USER, squadzPlusTier: "founding" } as never);
    const res = await post({
      event: {
        type: "EXPIRATION",
        app_user_id: "u1",
        product_id: FOUNDING,
        entitlement_ids: ["squadz_plus"],
      },
    });

    expect(res.status).toBe(200);
    expect(hoisted.setSquadzPlusForPeriod).toHaveBeenCalledWith("u1", false, null, null);
    expect(hoisted.captureMessage).not.toHaveBeenCalled();
  });
});

describe("POST /api/revenuecat/webhook — founding spot redemption", () => {
  it("redeems a founding spot on a paid founding INITIAL_PURCHASE, keyed by rc:<original_transaction_id>", async () => {
    const res = await post({
      event: {
        type: "INITIAL_PURCHASE",
        app_user_id: "u1",
        product_id: FOUNDING,
        entitlement_ids: ["squadz_plus"],
        period_type: "NORMAL",
        original_transaction_id: "1000000123",
      },
    });
    expect(res.status).toBe(200);
    expect(hoisted.setSquadzPlusForPeriod).toHaveBeenCalledWith("u1", true, null, "founding");
    expect(hoisted.redeemFoundingSpot).toHaveBeenCalledTimes(1);
    expect(hoisted.redeemFoundingSpot).toHaveBeenCalledWith("rc:1000000123");
  });

  it("does NOT redeem a founding spot for a TRIAL period (not a payment)", async () => {
    const res = await post({
      event: {
        type: "INITIAL_PURCHASE",
        app_user_id: "u1",
        product_id: FOUNDING,
        entitlement_ids: ["squadz_plus"],
        period_type: "TRIAL",
        original_transaction_id: "1000000999",
      },
    });
    expect(res.status).toBe(200);
    expect(hoisted.redeemFoundingSpot).not.toHaveBeenCalled();
  });

  it("re-redeems idempotently on RENEWAL (same original_transaction_id → same ledger key)", async () => {
    // The ledger is keyed by original_transaction_id, so a renewal re-calls
    // redeemFoundingSpot with the SAME key — a harmless no-op that can't
    // double-count the spot.
    const res = await post({
      event: {
        type: "RENEWAL",
        app_user_id: "u1",
        product_id: FOUNDING,
        entitlement_ids: ["squadz_plus"],
        period_type: "NORMAL",
        original_transaction_id: "1000000123",
      },
    });
    expect(res.status).toBe(200);
    expect(hoisted.redeemFoundingSpot).toHaveBeenCalledWith("rc:1000000123");
  });

  it("fails the webhook (500 → RevenueCat retries) when founding redemption throws", async () => {
    // Idempotent ledger means the retry can't double-count; failing is the only
    // way to avoid silently losing a paid founding spot on a transient DB error.
    hoisted.redeemFoundingSpot.mockRejectedValue(new Error("db down"));
    const res = await post({
      event: {
        type: "INITIAL_PURCHASE",
        app_user_id: "u1",
        product_id: FOUNDING,
        entitlement_ids: ["squadz_plus"],
        period_type: "NORMAL",
        original_transaction_id: "1000000err",
      },
    });
    expect(res.status).toBe(500);
  });
});
