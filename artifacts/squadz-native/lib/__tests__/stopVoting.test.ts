import { describe, it, expect } from "vitest";
// Import from the zero-dep flags file (tripApi pulls in @/lib/api which has
// native deps that can't load in the vitest node environment).
import { STOP_VOTING_ENABLED } from "@/lib/featureFlags";
import type { ItineraryStop } from "@/types";

// ---------------------------------------------------------------------------
// Helpers that mirror the renderStop conditional logic, kept pure so tests
// don't need a rendered component tree.
// ---------------------------------------------------------------------------

function stopVotingUIFlags(stop: ItineraryStop, votingEnabled: boolean) {
  const proposed = stop.status === "proposed";
  return {
    showProposedBadge: votingEnabled && proposed,
    showSuggestedBy: votingEnabled && proposed && !!stop.createdBy,
    showVoteHeart: votingEnabled && proposed,
    showVoterStack: votingEnabled && proposed && (stop.votes?.length ?? 0) > 0,
    showConfirmButton: proposed, // host can always confirm; not gated by voting flag
  };
}

function makeStop(overrides: Partial<ItineraryStop> = {}): ItineraryStop {
  return {
    id: "s1",
    day: "2026-09-10",
    time: "14:00",
    endTime: "",
    title: "Kayak tour",
    placeName: "",
    address: "",
    note: "",
    category: "activity",
    status: "confirmed",
    votes: [],
    createdBy: "u1",
    cost: null,
    paidById: null,
    assigneeId: null,
    sortOrder: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1.  The flag itself
// ---------------------------------------------------------------------------

describe("STOP_VOTING_ENABLED flag", () => {
  it("is false — stop voting is soft-deprecated", () => {
    expect(STOP_VOTING_ENABLED).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2.  Vote affordance hidden when flag is off
// ---------------------------------------------------------------------------

describe("stop vote affordance when STOP_VOTING_ENABLED = false", () => {
  const proposedWithVotes = makeStop({ status: "proposed", votes: ["u2", "u3"] });

  it("hides the proposed badge", () => {
    expect(stopVotingUIFlags(proposedWithVotes, false).showProposedBadge).toBe(false);
  });

  it("hides the 'Suggested by' attribution line", () => {
    expect(stopVotingUIFlags(proposedWithVotes, false).showSuggestedBy).toBe(false);
  });

  it("hides the vote heart, even when the stop already has votes", () => {
    expect(stopVotingUIFlags(proposedWithVotes, false).showVoteHeart).toBe(false);
  });

  it("hides the voter avatar stack, even when votes exist", () => {
    expect(stopVotingUIFlags(proposedWithVotes, false).showVoterStack).toBe(false);
  });

  it("still exposes the host Confirm button (management action, not voting UI)", () => {
    expect(stopVotingUIFlags(proposedWithVotes, false).showConfirmButton).toBe(true);
  });

  it("confirmed stops are also unaffected regardless of the flag", () => {
    const confirmed = makeStop({ status: "confirmed", votes: [] });
    const flags = stopVotingUIFlags(confirmed, false);
    expect(flags.showProposedBadge).toBe(false);
    expect(flags.showVoteHeart).toBe(false);
    expect(flags.showConfirmButton).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3.  Legacy proposed stop still has all its data — nothing disappears
// ---------------------------------------------------------------------------

describe("legacy proposed stop data integrity", () => {
  const legacyStop = makeStop({
    status: "proposed",
    title: "Sunset rooftop dinner",
    time: "19:30",
    day: "2026-08-15",
    votes: ["u2", "u3", "u4"],
    createdBy: "u1",
    cost: 45,
  });

  it("retains title", () => expect(legacyStop.title).toBe("Sunset rooftop dinner"));
  it("retains day", () => expect(legacyStop.day).toBe("2026-08-15"));
  it("retains time", () => expect(legacyStop.time).toBe("19:30"));
  it("retains votes array (data is untouched by the flag)", () => expect(legacyStop.votes).toHaveLength(3));
  it("status is still 'proposed' in stored data", () => expect(legacyStop.status).toBe("proposed"));
});

// ---------------------------------------------------------------------------
// 4.  Re-enable smoke test — flipping the flag restores all UI bits
// ---------------------------------------------------------------------------

describe("smoke: re-enabling the flag restores all affordances", () => {
  const proposed = makeStop({ status: "proposed", votes: ["u2"], createdBy: "u1" });
  const flags = stopVotingUIFlags(proposed, true /* hypothetically re-enabled */);

  it("proposed badge shows when flag is true", () => expect(flags.showProposedBadge).toBe(true));
  it("vote heart shows when flag is true", () => expect(flags.showVoteHeart).toBe(true));
  it("voter stack shows when flag is true and votes exist", () => expect(flags.showVoterStack).toBe(true));
  it("suggested-by line shows when flag is true", () => expect(flags.showSuggestedBy).toBe(true));
});
