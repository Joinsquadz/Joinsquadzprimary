import { describe, expect, it } from "vitest";
import { activePollScopeQuery } from "../activePollScope";

describe("activePollScopeQuery", () => {
  it("gives equivalent inline scope objects one stable request key", () => {
    expect(activePollScopeQuery({ type: "squad", squadId: "goon-gaming" }))
      .toBe(activePollScopeQuery({ type: "squad", squadId: "goon-gaming" }));
  });

  it("keeps squad and event scopes distinct and URL-safe", () => {
    expect(activePollScopeQuery({ type: "squad", squadId: "crew / 1" }))
      .toBe("squadId=crew%20%2F%201");
    expect(activePollScopeQuery({ type: "event", eventId: "plan-42" }))
      .toBe("eventId=plan-42");
  });
});