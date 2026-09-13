import { describe, expect, it } from "vitest";
import { normalizeSquadInviteCode } from "../inviteCode";

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

  it("extracts and normalizes a code from a canonical squad invite URL", () => {
    expect(
      normalizeSquadInviteCode(" https://joinsquadz.com/squad/join?code=sq-ab12 "),
    ).toBe("SQ-AB12");
  });

  it.each([
    "https://joinsquadz.com/join/event7",
    "https://joinsquadz.com/squad/join-public?id=squad-id",
    "https://example.com/squad/join?code=squad7",
    "http://joinsquadz.com/squad/join?code=squad7",
    "https://joinsquadz.com/squad/join",
    "not-a-url://joinsquadz.com/squad/join?code=squad7",
  ])("rejects non-squad or malformed invite URL %s", (value) => {
    expect(normalizeSquadInviteCode(value)).toBe("");
  });
});