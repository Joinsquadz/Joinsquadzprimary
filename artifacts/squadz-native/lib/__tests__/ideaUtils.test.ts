import { describe, it, expect } from "vitest";
import {
  groupConfirmedIdeas,
  mergedDayKeys,
  sortPendingIdeas,
  applyVoteToggle,
  moveWithinGroup,
  ideaSubmitterName,
  GENERAL_GROUP,
} from "@/lib/ideaUtils";
import type { PlanIdea } from "@/types";

function makeIdea(overrides: Partial<PlanIdea> = {}): PlanIdea {
  return {
    id: "i1",
    planId: "p1",
    title: "Kayaking",
    description: null,
    category: "activity",
    linkUrl: null,
    estimatedCost: null,
    suggestedDate: null,
    status: "pending",
    pinned: false,
    sortOrder: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    submittedBy: { id: "u1", firstName: "Ana", lastName: "Lee", profileImageUrl: null },
    voteCount: 0,
    votedByMe: false,
    ...overrides,
  };
}

describe("groupConfirmedIdeas", () => {
  it("only groups confirmed ideas, splitting dated vs general", () => {
    const ideas = [
      makeIdea({ id: "a", status: "confirmed", suggestedDate: "2026-08-10", sortOrder: 2 }),
      makeIdea({ id: "b", status: "confirmed", suggestedDate: "2026-08-10", sortOrder: 1 }),
      makeIdea({ id: "c", status: "confirmed", suggestedDate: null, sortOrder: 1 }),
      makeIdea({ id: "d", status: "pending", suggestedDate: "2026-08-10" }),
      makeIdea({ id: "e", status: "archived", suggestedDate: null }),
    ];
    const groups = groupConfirmedIdeas(ideas);
    expect(groups.byDay["2026-08-10"].map((i) => i.id)).toEqual(["b", "a"]); // sortOrder asc
    expect(groups.general.map((i) => i.id)).toEqual(["c"]);
    expect(Object.keys(groups.byDay)).toEqual(["2026-08-10"]);
  });

  it("breaks sortOrder ties (and nulls) by createdAt", () => {
    const ideas = [
      makeIdea({ id: "late", status: "confirmed", sortOrder: null, createdAt: "2026-08-02T00:00:00.000Z" }),
      makeIdea({ id: "early", status: "confirmed", sortOrder: null, createdAt: "2026-08-01T00:00:00.000Z" }),
    ];
    expect(groupConfirmedIdeas(ideas).general.map((i) => i.id)).toEqual(["early", "late"]);
  });
});

describe("mergedDayKeys", () => {
  it("keeps trip day keys first and untouched", () => {
    const keys = ["2026-08-10", "2026-08-11"];
    const groups = groupConfirmedIdeas([
      makeIdea({ id: "a", status: "confirmed", suggestedDate: "2026-08-11" }),
    ]);
    expect(mergedDayKeys(keys, groups)).toEqual(keys);
  });

  it("appends idea-only days after the known range, sorted", () => {
    const keys = ["2026-08-10"];
    const groups = groupConfirmedIdeas([
      makeIdea({ id: "a", status: "confirmed", suggestedDate: "2026-09-02" }),
      makeIdea({ id: "b", status: "confirmed", suggestedDate: "2026-09-01" }),
    ]);
    expect(mergedDayKeys(keys, groups)).toEqual(["2026-08-10", "2026-09-01", "2026-09-02"]);
  });
});

describe("sortPendingIdeas", () => {
  const a = makeIdea({ id: "a", voteCount: 1, createdAt: "2026-08-01T00:00:00.000Z" });
  const b = makeIdea({ id: "b", voteCount: 5, createdAt: "2026-08-02T00:00:00.000Z" });
  const pinned = makeIdea({ id: "p", voteCount: 0, pinned: true, createdAt: "2026-07-01T00:00:00.000Z" });

  it("puts pinned first regardless of votes", () => {
    expect(sortPendingIdeas([a, b, pinned], "votes").map((i) => i.id)).toEqual(["p", "b", "a"]);
  });

  it("sorts newest-first under 'created'", () => {
    expect(sortPendingIdeas([a, b], "created").map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("does not mutate the input array", () => {
    const input = [a, b];
    sortPendingIdeas(input, "votes");
    expect(input.map((i) => i.id)).toEqual(["a", "b"]);
  });

  // Regression: null createdAt must not throw (DB rows pre-date the createdAt column).
  it("does not throw when createdAt is null", () => {
    const noDate = makeIdea({ id: "nd", createdAt: null as unknown as string });
    expect(() => sortPendingIdeas([a, noDate], "votes")).not.toThrow();
    expect(() => sortPendingIdeas([a, noDate], "created")).not.toThrow();
  });
});

describe("groupConfirmedIdeas — null createdAt regression", () => {
  // Regression: bySortOrder calls createdAt.localeCompare for tie-breaking.
  // A null createdAt must not throw (older DB rows may lack the column).
  it("does not throw when confirmed ideas have null createdAt", () => {
    const ideas = [
      makeIdea({ id: "a", status: "confirmed", sortOrder: null, createdAt: null as unknown as string }),
      makeIdea({ id: "b", status: "confirmed", sortOrder: null, createdAt: "2026-08-01T00:00:00.000Z" }),
    ];
    expect(() => groupConfirmedIdeas(ideas)).not.toThrow();
    const groups = groupConfirmedIdeas(ideas);
    // Both should appear in the general bucket (no suggestedDate).
    expect(groups.general.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });
});

describe("applyVoteToggle", () => {
  it("adds a vote when not voted", () => {
    const [out] = applyVoteToggle([makeIdea({ voteCount: 2, votedByMe: false })], "i1");
    expect(out.votedByMe).toBe(true);
    expect(out.voteCount).toBe(3);
  });

  it("removes a vote when already voted, never going negative", () => {
    const [out] = applyVoteToggle([makeIdea({ voteCount: 0, votedByMe: true })], "i1");
    expect(out.votedByMe).toBe(false);
    expect(out.voteCount).toBe(0);
  });

  it("leaves other ideas untouched", () => {
    const ideas = [makeIdea({ id: "x", voteCount: 1 }), makeIdea({ id: "y", voteCount: 1 })];
    const out = applyVoteToggle(ideas, "x");
    expect(out.find((i) => i.id === "y")!.voteCount).toBe(1);
  });
});

describe("moveWithinGroup", () => {
  const group = [
    makeIdea({ id: "a", status: "confirmed", sortOrder: 1 }),
    makeIdea({ id: "b", status: "confirmed", sortOrder: 2 }),
    makeIdea({ id: "c", status: "confirmed", sortOrder: 3 }),
  ];

  it("swaps with the neighbor and returns the FULL id list", () => {
    expect(moveWithinGroup(group, "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveWithinGroup(group, "b", "down")).toEqual(["a", "c", "b"]);
  });

  it("returns null at the edges and for unknown ids", () => {
    expect(moveWithinGroup(group, "a", "up")).toBeNull();
    expect(moveWithinGroup(group, "c", "down")).toBeNull();
    expect(moveWithinGroup(group, "zzz", "down")).toBeNull();
  });
});

describe("ideaSubmitterName", () => {
  it("joins first/last and falls back to 'Someone'", () => {
    expect(ideaSubmitterName(makeIdea())).toBe("Ana Lee");
    expect(ideaSubmitterName(makeIdea({ submittedBy: null }))).toBe("Someone");
    expect(
      ideaSubmitterName(makeIdea({ submittedBy: { id: "u", firstName: null, lastName: null, profileImageUrl: null } })),
    ).toBe("Someone");
  });
});

// GENERAL_GROUP is a screen-level sentinel, not a valid day key — guard against
// someone "simplifying" it into a date-shaped string.
it("GENERAL_GROUP cannot collide with ISO day keys", () => {
  expect(/^\d{4}-\d{2}-\d{2}$/.test(GENERAL_GROUP)).toBe(false);
});
