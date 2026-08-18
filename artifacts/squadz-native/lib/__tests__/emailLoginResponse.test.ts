import { describe, expect, it } from "vitest";
import { classifyEmailLoginResponse } from "../emailLoginResponse";

const usableSession = { token: "session-token", user: { id: "user-1" } };

describe("email login response classification", () => {
  it("only calls a genuine 401 an incorrect-credentials failure", () => {
    expect(classifyEmailLoginResponse(401, { error: "anything" })).toEqual({
      kind: "invalid-credentials",
      error: "Incorrect email or password.",
    });
  });

  it("treats a successful response without a token as a malformed service response", () => {
    expect(classifyEmailLoginResponse(200, { user: { id: "user-1" } })).toMatchObject({
      kind: "malformed-success",
      error: expect.not.stringContaining("password"),
    });
  });

  it("treats a successful response without a user as a malformed service response", () => {
    expect(classifyEmailLoginResponse(204, { token: "session-token" })).toMatchObject({
      kind: "malformed-success",
      error: expect.not.stringContaining("password"),
    });
  });

  it("accepts only a successful response carrying a usable session", () => {
    expect(classifyEmailLoginResponse(200, usableSession)).toEqual({ kind: "success" });
  });

  it("does not mislabel rate limiting or server errors as credential failures", () => {
    expect(classifyEmailLoginResponse(429, {})).toMatchObject({ kind: "request-failure" });
    expect(classifyEmailLoginResponse(500, {})).toMatchObject({
      kind: "request-failure",
      error: expect.not.stringContaining("password"),
    });
  });
});