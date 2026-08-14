import { describe, expect, it } from "vitest";
import { shouldAutoSelectDefaultSquad } from "../createDefaults";

describe("shouldAutoSelectDefaultSquad", () => {
  it("does not select a squad for plans started on Home", () => {
    expect(shouldAutoSelectDefaultSquad({ from: "home", squadCount: 2 })).toBe(false);
  });

  it("does not replace an explicitly standalone squad choice", () => {
    expect(shouldAutoSelectDefaultSquad({ prefillSquad: "", squadCount: 2 })).toBe(false);
  });

  it("keeps the default for squad-oriented entry points without a selection", () => {
    expect(shouldAutoSelectDefaultSquad({ squadCount: 2 })).toBe(true);
  });

  it("does not select when the user has no squads", () => {
    expect(shouldAutoSelectDefaultSquad({ squadCount: 0 })).toBe(false);
  });
});