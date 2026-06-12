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

// The client no longer looks up prices or sends a priceId — the server decides
// founding vs standard atomically and returns the checkout URL + chosen tier.
describe("startProCheckout", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveApiBase.mockReturnValue("https://api.example.com");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("happy path: POSTs to /api/checkout with no priceId, opens the URL, returns the server tier", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ url: "https://checkout.stripe.com/session_123", tier: "founding" }),
    );

    const result = await startProCheckout("tok_abc");

    expect(result).toEqual({ ok: true, tier: "founding" });

    // Exactly one network call — the checkout POST. No product/price lookup.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [checkoutUrl, checkoutInit] = fetchMock.mock.calls[0];
    expect(checkoutUrl).toBe("https://api.example.com/api/checkout");
    expect(checkoutInit).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok_abc" },
    });
    // The client cannot self-select a price — the body carries no priceId.
    expect(JSON.parse(checkoutInit.body)).toEqual({});

    expect(mockOpenURL).toHaveBeenCalledTimes(1);
    expect(mockOpenURL).toHaveBeenCalledWith("https://checkout.stripe.com/session_123");
  });

  it("returns ok with the standard tier when the server picks standard", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ url: "https://checkout.stripe.com/session_std", tier: "standard" }),
    );

    const result = await startProCheckout("tok_abc");

    expect(result).toEqual({ ok: true, tier: "standard" });
  });

  it("omits the Authorization header when no token is provided", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ url: "https://checkout.stripe.com/session_123", tier: "standard" }),
    );

    const result = await startProCheckout(null);

    expect(result).toEqual({ ok: true, tier: "standard" });
    const [, checkoutInit] = fetchMock.mock.calls[0];
    expect(checkoutInit.headers).not.toHaveProperty("Authorization");
  });

  it("surfaces the API error message when checkout responds with an error", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ error: "You are already Pro." }));

    const result = await startProCheckout("tok_abc");

    expect(result).toEqual({ ok: false, error: "You are already Pro." });
    expect(mockOpenURL).not.toHaveBeenCalled();
  });

  it("returns a generic error when checkout responds without a URL or error", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({}));

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
    fetchMock.mockResolvedValueOnce(
      jsonOk({ url: "https://checkout.stripe.com/first", tier: "standard" }),
    );
    mockResolveApiBase.mockReturnValueOnce("https://first.example.com");

    await startProCheckout("tok_abc");

    expect(mockResolveApiBase).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://first.example.com/api/checkout");

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(
      jsonOk({ url: "https://checkout.stripe.com/second", tier: "standard" }),
    );
    mockResolveApiBase.mockReturnValueOnce("https://second.example.com");

    await startProCheckout("tok_abc");

    expect(mockResolveApiBase).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://second.example.com/api/checkout");
  });
});
