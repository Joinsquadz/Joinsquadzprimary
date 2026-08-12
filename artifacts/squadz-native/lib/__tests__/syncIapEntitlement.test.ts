/**
 * syncIapEntitlement (lib/api.ts).
 *
 * POST /api/iap/sync makes the server read RevenueCat directly, so ONE
 * successful call is authoritative — this is what replaced the old post-purchase
 * polling loop over /api/subscription. The contract that matters to callers:
 *
 *   - success carries the resolved entitlement (so the UI can adopt it)
 *   - failure carries NO entitlement, and says whether a retry could help,
 *     so a transient blip is never mistaken for "user is not entitled"
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import { syncIapEntitlement } from "@/lib/api";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("syncIapEntitlement — success", () => {
  it("returns the entitlement and tier reported by the server", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ isSquadzPlus: true, tier: "founding" }));

    const result = await syncIapEntitlement("tok");

    expect(result).toEqual({ ok: true, entitlement: { entitled: true, tier: "founding" } });
  });

  it("reports tier 'none' when the user is not entitled", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ isSquadzPlus: false, tier: "none" }));

    const result = await syncIapEntitlement("tok");

    expect(result).toEqual({ ok: true, entitlement: { entitled: false, tier: "none" } });
  });

  it("falls back to 'standard' for an entitled user when the server omits tier", async () => {
    // Older server build: the entitlement must still be honoured, only the badge
    // degrades. Reading this as "none" would gate a paying subscriber.
    fetchMock.mockResolvedValue(jsonResponse({ isSquadzPlus: true }));

    const result = await syncIapEntitlement("tok");

    expect(result).toEqual({ ok: true, entitlement: { entitled: true, tier: "standard" } });
  });
});

describe("syncIapEntitlement — failure carries no entitlement", () => {
  it("marks a 5xx as retryable", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 503));

    const result = await syncIapEntitlement("tok");

    expect(result).toEqual({ ok: false, retryable: true, status: 503 });
  });

  it("marks a 401 as NOT retryable (a retry will fail identically)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 401));

    const result = await syncIapEntitlement("tok");

    expect(result).toEqual({ ok: false, retryable: false, status: 401 });
  });

  it("marks a thrown network error as retryable", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    const result = await syncIapEntitlement("tok");

    expect(result).toEqual({ ok: false, retryable: true });
  });

  it("never reports a failure as an un-entitled reading", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    const result = await syncIapEntitlement("tok");

    // The absence of `entitlement` is the point: callers cannot accidentally
    // treat a network failure as proof the user isn't subscribed.
    expect(result.ok).toBe(false);
    expect("entitlement" in result).toBe(false);
  });
});
