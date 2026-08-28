import { describe, expect, it } from "vitest";
import { classifySupabaseRefreshError } from "../lib/authRefresh";

describe("classifySupabaseRefreshError", () => {
  it("marks missing, reused, and rejected refresh credentials invalid", () => {
    expect(
      classifySupabaseRefreshError({
        status: 400,
        code: "refresh_token_not_found",
      }),
    ).toBe("invalid");
    expect(
      classifySupabaseRefreshError({
        status: 400,
        code: "refresh_token_already_used",
      }),
    ).toBe("invalid");
    expect(classifySupabaseRefreshError({ status: 401 })).toBe("invalid");
  });

  it("preserves sessions for provider outages, throttling, and fetch failures", () => {
    expect(classifySupabaseRefreshError({ status: 429 })).toBe("transient");
    expect(classifySupabaseRefreshError({ status: 503 })).toBe("transient");
    expect(
      classifySupabaseRefreshError(new TypeError("network unavailable")),
    ).toBe("transient");
  });
});