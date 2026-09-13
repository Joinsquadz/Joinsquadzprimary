import { describe, expect, it } from "vitest";
import { normalizeSquadInviteCode } from "./inviteCode";

describe("normalizeSquadInviteCode", () => {
  it("trims surrounding whitespace and uppercases the code", () => {
    expect(normalizeSquadInviteCode("  sq-ab12 \n")).toBe("SQ-AB12");
  });

  it("preserves the code's internal format", () => {
    expect(normalizeSquadInviteCode("sq ab-12")).toBe("SQ AB-12");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeSquadInviteCode(" \t ")).toBe("");
  });
});