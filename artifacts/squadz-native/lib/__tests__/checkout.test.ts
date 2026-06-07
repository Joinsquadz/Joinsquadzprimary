import { describe, it, expect, vi, beforeEach } from "vitest";

const mockOpenURL = vi.hoisted(() => vi.fn(async () => true));
const mockResolveApiBase = vi.hoisted(() => vi.fn(() => "https://api.example.com"));
const mockBuildAuthHeaders = vi.hoisted(() =>
  vi.fn((token: string | null) => (token ? { Authorization: `Bearer ${token}` } : {})),
);

vi.mock("react-native", () => ({
  Linking: { openURL: mockOpenURL },
}));

vi.mock("@/lib/api", () => ({
  resolveApiBase: mockResolveApiBase,
  buildAuthHeaders: mockBuildAuthHeaders,
}));

import { startProCheckout } from "../checkout";

type JsonResponse = { json: () => Promise<unknown> };

function jsonOk(body: unknown): JsonResponse {
  return { json: async () => body };
}

const PRO_PRODUCTS = {
  data: [
    {
      id: "prod_free",
      name: "Squadz Free",
      prices: [{ id: "price_free", recurring: { interval: "month" } }],
    },
    {
      id: "prod_pro",
      name: "Squadz Pro",
      prices: [
        { id: "price_pro_monthly", recurring: { interval: "month" } },
        { id: "price_pro_yearly", recurring: { interval: "year" } },
      ],
    },
  ],
};

describe("startProCheckout", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveApiBase.mockReturnValue("https://api.example.com");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("happy path: finds Pro yearly price, opens checkout URL, returns { ok: true }", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk(PRO_PRODUCTS))
      .mockResolvedValueOnce(jsonOk({ url: "https://checkout.stripe.com/session_123" }));

    const result = await startProCheckout("tok_abc");

    expect(result).toEqual({ ok: true });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://api.example.com/api/products-with-prices");

    const [checkoutUrl, checkoutInit] = fetchMock.mock.calls[1];
    expect(checkoutUrl).toBe("https://api.example.com/api/checkout");
    expect(checkoutInit).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok_abc" },
    });
    expect(JSON.parse(checkoutInit.body)).toEqual({ priceId: "price_pro_yearly" });

    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledWith("https://checkout.stripe.com/session_123");
  });

  it("omits the Authorization header when no token is provided", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk(PRO_PRODUCTS))
      .mockResolvedValueOnce(jsonOk({ url: "https://checkout.stripe.com/session_123" }));

    const result = await startProCheckout(null);

    expect(result).toEqual({ ok: true });
    const [, checkoutInit] = fetchMock.mock.calls[1];
    expect(checkoutInit.headers).not.toHaveProperty("Authorization");
  });

  it("returns { ok: false } when the Pro product is missing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({
        data: [
          {
            id: "prod_free",
            name: "Squadz Free",
            prices: [{ id: "price_free", recurring: { interval: "month" } }],
          },
        ],
      }),
    );

    const result = await startProCheckout("tok_abc");

    expect(result).toEqual({ ok: false, error: "Pro plan not found. Please try again later." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it("returns { ok: false } when the Pro product has no yearly price", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({
        data: [
          {
            id: "prod_pro",
            name: "Squadz Pro",
            prices: [{ id: "price_pro_monthly", recurring: { interval: "month" } }],
          },
        ],
      }),
    );

    const result = await startProCheckout("tok_abc");

    expect(result).toEqual({ ok: false, error: "Pro plan not found. Please try again later." });
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it("surfaces the API error message when checkout responds with an error", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk(PRO_PRODUCTS))
      .mockResolvedValueOnce(jsonOk({ error: "You are already Pro." }));

    const result = await startProCheckout("tok_abc");

    expect(result).toEqual({ ok: false, error: "You are already Pro." });
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it("returns a generic error when checkout responds without a URL or error", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk(PRO_PRODUCTS))
      .mockResolvedValueOnce(jsonOk({}));

    const result = await startProCheckout("tok_abc");

    expect(result).toEqual({
      ok: false,
      error: "Failed to start checkout. Please try again.",
    });
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it("returns { ok: false } when fetch throws (network/exception path)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const result = await startProCheckout("tok_abc");

    expect(result).toEqual({ ok: false, error: "Something went wrong. Please try again." });
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it("resolves the API base at call time (dynamic), not at import time", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonOk(PRO_PRODUCTS))
      .mockResolvedValueOnce(jsonOk({ url: "https://checkout.stripe.com/first" }));
    mockResolveApiBase.mockReturnValueOnce("https://first.example.com");

    await startProCheckout("tok_abc");

    expect(mockResolveApiBase).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://first.example.com/api/products-with-prices");

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(jsonOk(PRO_PRODUCTS))
      .mockResolvedValueOnce(jsonOk({ url: "https://checkout.stripe.com/second" }));
    mockResolveApiBase.mockReturnValueOnce("https://second.example.com");

    await startProCheckout("tok_abc");

    expect(mockResolveApiBase).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://second.example.com/api/products-with-prices");
  });
});
