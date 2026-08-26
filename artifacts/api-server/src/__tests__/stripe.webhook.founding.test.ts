import { describe, it, expect, vi, beforeEach } from "vitest";

// Verifies the checkout.session.completed webhook consumes a Founding Member
// spot ONLY for a founding-tier purchase, and never for standard tier or other
// event types. The redemption's per-subscription idempotency is proven against
// a real Postgres in __tests__/concurrency/realDb.concurrency.test.ts.

const hoisted = vi.hoisted(() => ({
  constructEventAsync: vi.fn(),
  processWebhook: vi.fn().mockResolvedValue(undefined),
  redeemFoundingSpot: vi.fn().mockResolvedValue("redeemed"),
  dbExecute: vi.fn().mockResolvedValue({ rows: [{ secret: "whsec_test" }] }),
  getUserByStripeCustomerId: vi.fn().mockResolvedValue(null),
  updateUserStripeInfo: vi.fn().mockResolvedValue(undefined),
  sendProWelcome: vi.fn().mockResolvedValue(undefined),
  sendRenewalReceipt: vi.fn().mockResolvedValue(undefined),
  sendPaymentFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("stripe", () => ({
  Stripe: class {
    webhooks = { constructEventAsync: hoisted.constructEventAsync };
  },
}));

vi.mock("../stripeClient", () => ({
  getStripeSync: vi.fn().mockResolvedValue({ processWebhook: hoisted.processWebhook }),
}));

vi.mock("../lib/founding", () => ({ redeemFoundingSpot: hoisted.redeemFoundingSpot }));

vi.mock("@workspace/db", () => ({ db: { execute: hoisted.dbExecute } }));

vi.mock("../storage", () => ({
  storage: {
    getUserByStripeCustomerId: hoisted.getUserByStripeCustomerId,
    updateUserStripeInfo: hoisted.updateUserStripeInfo,
  },
}));

vi.mock("../emailService", () => ({
  emailService: {
    sendProWelcome: hoisted.sendProWelcome,
    sendRenewalReceipt: hoisted.sendRenewalReceipt,
    sendPaymentFailed: hoisted.sendPaymentFailed,
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { WebhookHandlers } from "../webhookHandlers";

const PAYLOAD = Buffer.from("{}");
const SIG = "sig_test";

function mockEvent(type: string, object: unknown): void {
  hoisted.constructEventAsync.mockResolvedValue({ type, data: { object } });
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.processWebhook.mockResolvedValue(undefined);
  hoisted.redeemFoundingSpot.mockResolvedValue("redeemed");
  hoisted.dbExecute.mockResolvedValue({ rows: [{ secret: "whsec_test" }] });
});

describe("checkout.session.completed → founding spot redemption", () => {
  it("redeems a founding spot for a founding-tier checkout", async () => {
    mockEvent("checkout.session.completed", {
      customer: "cus_1",
      subscription: "sub_123",
      metadata: { userId: "u1", tier: "founding" },
    });

    await WebhookHandlers.processWebhook(PAYLOAD, SIG);

    expect(hoisted.redeemFoundingSpot).toHaveBeenCalledTimes(1);
    expect(hoisted.redeemFoundingSpot).toHaveBeenCalledWith("sub_123");
  });

  it("does NOT redeem a spot for a standard-tier checkout", async () => {
    mockEvent("checkout.session.completed", {
      customer: "cus_1",
      subscription: "sub_456",
      metadata: { userId: "u1", tier: "standard" },
    });

    await WebhookHandlers.processWebhook(PAYLOAD, SIG);

    expect(hoisted.redeemFoundingSpot).not.toHaveBeenCalled();
  });

  it("does NOT redeem a spot when tier metadata is absent", async () => {
    mockEvent("checkout.session.completed", {
      customer: "cus_1",
      subscription: "sub_789",
      metadata: null,
    });

    await WebhookHandlers.processWebhook(PAYLOAD, SIG);

    expect(hoisted.redeemFoundingSpot).not.toHaveBeenCalled();
  });

  it("does NOT redeem a spot for non-checkout events", async () => {
    mockEvent("customer.subscription.updated", {
      id: "sub_abc",
      customer: "cus_1",
    });

    await WebhookHandlers.processWebhook(PAYLOAD, SIG);

    expect(hoisted.redeemFoundingSpot).not.toHaveBeenCalled();
  });

  it("fails the webhook (so Stripe retries) when founding redemption throws", async () => {
    // The spot is consumed via an idempotent ledger, so a retry can't
    // double-count; failing the webhook is the only way to avoid silently
    // losing a paid founding spot on a transient DB error.
    hoisted.redeemFoundingSpot.mockRejectedValue(new Error("db down"));
    mockEvent("checkout.session.completed", {
      customer: "cus_1",
      subscription: "sub_err",
      metadata: { tier: "founding" },
    });

    await expect(WebhookHandlers.processWebhook(PAYLOAD, SIG)).rejects.toThrow("db down");
    // Sync ran before the throw, so Stripe's retry re-runs an idempotent sync.
    expect(hoisted.processWebhook).toHaveBeenCalledTimes(1);
  });
});
