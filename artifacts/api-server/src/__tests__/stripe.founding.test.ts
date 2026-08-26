import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Founding-pricing route wiring (mocked). The atomic concurrency guarantee of
// decideCheckoutTier itself is proven against a real Postgres in
// __tests__/concurrency/realDb.concurrency.test.ts (F1).

const foundingMock = vi.hoisted(() => ({
  decideCheckoutTier: vi.fn<() => Promise<"founding" | "standard">>(),
  priceIdForTier: vi.fn((tier: "founding" | "standard") =>
    tier === "founding" ? "price_founding" : "price_standard",
  ),
  getFoundingStatus: vi.fn(),
}));

vi.mock("../lib/founding", () => foundingMock);

vi.mock("../storage", () => ({
  storage: {
    getUser: vi.fn(),
    upsertUser: vi.fn(),
    getSubscription: vi.fn().mockResolvedValue(null),
    getActiveSubscriptionByCustomerId: vi.fn().mockResolvedValue(null),
    updateUserStripeInfo: vi.fn(),
    listProductsWithPrices: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../stripeService", () => ({
  stripeService: {
    createCustomer: vi.fn().mockResolvedValue({ id: "cus_new" }),
    createCheckoutSession: vi.fn().mockResolvedValue({ url: "https://checkout.example/abc" }),
    createCustomerPortalSession: vi.fn().mockResolvedValue({ url: "https://billing.example/portal" }),
  },
}));

vi.mock("../services/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../lib/urls", () => ({ getBaseUrl: () => "https://app.example" }));
vi.mock("../emailService", () => ({ buildProWelcomeHtml: () => "" }));
vi.mock("../lib/logger");

import stripeRouter from "../routes/stripe";
import { makeTestApp, type TestUser } from "./helpers/makeTestApp";
import { storage } from "../storage";

const makeApp = (user?: TestUser) => makeTestApp(stripeRouter, user);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/subscription/founding-status (public)", () => {
  it("returns founding availability without auth", async () => {
    foundingMock.getFoundingStatus.mockResolvedValue({
      spotsRemaining: 312,
      isFoundingAvailable: true,
      limit: 500,
    });

    const res = await request(makeApp()).get("/api/subscription/founding-status");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ spotsRemaining: 312, isFoundingAvailable: true, limit: 500 });
  });

  it("reports unavailable when sold out", async () => {
    foundingMock.getFoundingStatus.mockResolvedValue({
      spotsRemaining: 0,
      isFoundingAvailable: false,
      limit: 500,
    });

    const res = await request(makeApp()).get("/api/subscription/founding-status");

    expect(res.status).toBe(200);
    expect(res.body.isFoundingAvailable).toBe(false);
    expect(res.body.spotsRemaining).toBe(0);
  });
});

describe("GET /api/subscription/founding-status/fresh (purchase-time guard)", () => {
  it("bypasses a warmed display cache after the final founding spot is consumed", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    foundingMock.getFoundingStatus
      .mockResolvedValueOnce({ spotsRemaining: 1, isFoundingAvailable: true, limit: 500 })
      .mockResolvedValueOnce({ spotsRemaining: 0, isFoundingAvailable: false, limit: 500 });

    try {
      // The display endpoint caches its "one spot left" response in production.
      const display = await request(makeApp()).get("/api/subscription/founding-status");
      expect(display.body.isFoundingAvailable).toBe(true);

      // A purchase immediately afterward must bypass that cache and observe the
      // closed cohort, rather than letting StoreKit/Play open founding checkout.
      const purchaseCheck = await request(makeApp()).get("/api/subscription/founding-status/fresh");
      expect(purchaseCheck.status).toBe(200);
      expect(purchaseCheck.body).toEqual({ spotsRemaining: 0, isFoundingAvailable: false, limit: 500 });
      expect(purchaseCheck.headers["cache-control"]).toContain("no-store");
      expect(foundingMock.getFoundingStatus).toHaveBeenCalledTimes(2);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});

describe("POST /api/checkout — intentionally disabled", () => {
  it("returns an intentional deprecation response without authentication", async () => {
    const res = await request(makeApp()).post("/api/checkout").send({});
    expect(res.status).toBe(410);
    expect(res.body).toEqual({
      error: "Stripe Checkout has been permanently disabled",
      code: "STRIPE_CHECKOUT_DISABLED",
    });
  });

  it("does not invoke Stripe or founding-tier logic", async () => {
    const res = await request(makeApp({ id: "u1", email: "u1@example.test" }))
      .post("/api/checkout")
      .send({ priceId: "price_founding" });

    expect(res.status).toBe(410);
    expect(foundingMock.decideCheckoutTier).not.toHaveBeenCalled();
    const { stripeService } = await import("../stripeService");
    expect(vi.mocked(stripeService.createCustomer)).not.toHaveBeenCalled();
    expect(vi.mocked(stripeService.createCheckoutSession)).not.toHaveBeenCalled();
  });
});

describe("POST /api/portal", () => {
  it("returns an intentional deprecation response without authentication", async () => {
    const res = await request(makeApp()).post("/api/portal").send({});

    expect(res.status).toBe(410);
    expect(res.body).toEqual({
      error: "Stripe Billing Portal has been permanently disabled",
      code: "STRIPE_PORTAL_DISABLED",
    });
  });

  it("does not invoke Stripe customer lookup or portal creation", async () => {
    const res = await request(makeApp({ id: "u1", email: "u1@example.test" }))
      .post("/api/portal")
      .send({});

    expect(res.status).toBe(410);
    const { stripeService } = await import("../stripeService");
    expect(vi.mocked(stripeService.createCustomerPortalSession)).not.toHaveBeenCalled();
    expect(vi.mocked(storage.getUser)).not.toHaveBeenCalled();
  });
});
