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

const VERIFIED_CUSTOMER = {
  id: "u1",
  email: "u1@example.test",
  emailVerified: true,
  stripeCustomerId: "cus_1",
  stripeSubscriptionId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  foundingMock.priceIdForTier.mockImplementation((tier) =>
    tier === "founding" ? "price_founding" : "price_standard",
  );
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

describe("POST /api/checkout — server-chosen tier", () => {
  it("requires authentication", async () => {
    const res = await request(makeApp()).post("/api/checkout").send({});
    expect(res.status).toBe(401);
  });

  it("applies the founding price when a spot is claimed and returns the tier", async () => {
    vi.mocked(storage.getUser).mockResolvedValue(VERIFIED_CUSTOMER as never);
    foundingMock.decideCheckoutTier.mockResolvedValue("founding");

    const res = await request(makeApp({ id: "u1", email: "u1@example.test" }))
      .post("/api/checkout")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe("founding");
    expect(res.body.priceId).toBe("price_founding");
    expect(res.body.url).toBe("https://checkout.example/abc");

    const { stripeService } = await import("../stripeService");
    expect(vi.mocked(stripeService.createCheckoutSession)).toHaveBeenCalledWith(
      "cus_1",
      "price_founding",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ userId: "u1", tier: "founding" }),
    );
  });

  it("falls back to the standard price when founding is sold out", async () => {
    vi.mocked(storage.getUser).mockResolvedValue(VERIFIED_CUSTOMER as never);
    foundingMock.decideCheckoutTier.mockResolvedValue("standard");

    const res = await request(makeApp({ id: "u1", email: "u1@example.test" }))
      .post("/api/checkout")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe("standard");
    expect(res.body.priceId).toBe("price_standard");
  });

  it("ignores any client-supplied priceId (cannot self-select founding)", async () => {
    vi.mocked(storage.getUser).mockResolvedValue(VERIFIED_CUSTOMER as never);
    foundingMock.decideCheckoutTier.mockResolvedValue("standard");

    const res = await request(makeApp({ id: "u1", email: "u1@example.test" }))
      .post("/api/checkout")
      .send({ priceId: "price_founding" });

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe("standard");
    expect(res.body.priceId).toBe("price_standard");
  });

  it("allows checkout for an unverified email (verification no longer gates upgrade)", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      ...VERIFIED_CUSTOMER,
      emailVerified: false,
    } as never);
    foundingMock.decideCheckoutTier.mockResolvedValue("standard");

    const res = await request(makeApp({ id: "u1", email: "u1@example.test" }))
      .post("/api/checkout")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.tier).toBe("standard");
    expect(res.body.url).toBe("https://checkout.example/abc");
    expect(foundingMock.decideCheckoutTier).toHaveBeenCalled();
  });

  it("blocks checkout when the user already has an active subscription", async () => {
    vi.mocked(storage.getUser).mockResolvedValue({
      ...VERIFIED_CUSTOMER,
      stripeSubscriptionId: "sub_active",
    } as never);
    vi.mocked(storage.getSubscription).mockResolvedValue({ status: "active" } as never);

    const res = await request(makeApp({ id: "u1", email: "u1@example.test" }))
      .post("/api/checkout")
      .send({});

    expect(res.status).toBe(400);
    expect(foundingMock.decideCheckoutTier).not.toHaveBeenCalled();
  });
});
