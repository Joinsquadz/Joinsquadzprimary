import { describe, expect, it } from "vitest";
import { shouldInvalidateConfirmedSession } from "../sessionRecovery";

describe("confirmed-session 401 recovery", () => {
  it("invalidates a confirmed session when protected home data rejects its token", () => {
    expect(
      shouldInvalidateConfirmedSession({
        path: "/api/discover",
        isSessionValidated: true,
        hasSessionToken: true,
      }),
    ).toBe(true);
  });

  it("keeps the cold-start token-restoration grace period", () => {
    expect(
      shouldInvalidateConfirmedSession({
        path: "/api/squads",
        isSessionValidated: false,
        hasSessionToken: true,
      }),
    ).toBe(false);
  });

  it("does not mistake login-route failures or logged-out requests for an expired session", () => {
    expect(
      shouldInvalidateConfirmedSession({
        path: "/api/auth/login",
        isSessionValidated: true,
        hasSessionToken: true,
      }),
    ).toBe(false);
    expect(
      shouldInvalidateConfirmedSession({
        path: "/api/events",
        isSessionValidated: true,
        hasSessionToken: false,
      }),
    ).toBe(false);
  });
});