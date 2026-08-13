// Pure-helper coverage for the "Find the Best Time" wizard, organizer edits,
// follow-up/nudge rules and the in-poll alternate-time picker.
//
// These helpers are deliberately React-free (see lib/pollWizard.ts) so they run
// under the node-environment vitest config without loading react-native.
import { describe, it, expect } from "vitest";

import {
  DEFAULT_SLOTS,
  sortSlotsChronologically,
  periodForSlot,
  selectionsOutsidePeriod,
  pollWizardSteps,
  isLastWizardStep,
  nextWizardStep,
  prevWizardStep,
  wizardBackExits,
  canAdvanceWizard,
  wizardReviewLine,
  computeTrimLoss,
  computeTrimLossFromHeatmap,
  trimLossMessage,
  saveButtonState,
  memberFollowUpState,
  canNudgeMember,
  buildFollowUpList,
  followUpStateLabel,
  rankPollCells,
  pollStatusLabel,
  pollResultKind,
  shouldNudgePollWinner,
  editRangeSnapshot,
  editRangeDirty,
  editChangesGrid,
  initialEditTripLength,
  editTripLengthPatchValue,
} from "../pollWizard";

describe("wizard step navigation", () => {
  // Both flows are three steps; only the third differs. A trip's third step is
  // its LENGTH — the span of the trip itself, which is a separate question from
  // the voting window picked on the dates step.
  it("uses three steps for both, ending in times for events and length for trips", () => {
    expect(pollWizardSteps(false).map((s) => s.id)).toEqual(["name", "dates", "times"]);
    expect(pollWizardSteps(true).map((s) => s.id)).toEqual(["name", "dates", "length"]);
  });

  it("advances forward and back without leaving the range", () => {
    expect(nextWizardStep(0, false)).toBe(1);
    expect(nextWizardStep(1, false)).toBe(2);
    // Clamped at the last step rather than running past the end.
    expect(nextWizardStep(2, false)).toBe(2);
    expect(prevWizardStep(1)).toBe(0);
    expect(prevWizardStep(0)).toBe(0);
  });

  it("treats the third step as last for both events and trips", () => {
    expect(isLastWizardStep(1, false)).toBe(false);
    expect(isLastWizardStep(2, false)).toBe(true);
    expect(isLastWizardStep(1, true)).toBe(false);
    expect(isLastWizardStep(2, true)).toBe(true);
  });

  it("advances a trip from dates into the length step", () => {
    expect(nextWizardStep(1, true)).toBe(2);
    expect(nextWizardStep(2, true)).toBe(2);
  });

  it("exits the flow only from the first step", () => {
    expect(wizardBackExits(0)).toBe(true);
    expect(wizardBackExits(1)).toBe(false);
  });

  it("lets the title step be skipped but requires at least one slot", () => {
    expect(canAdvanceWizard(0, false, { slotCount: 0 })).toBe(true);
    expect(canAdvanceWizard(1, false, { slotCount: 0 })).toBe(true);
    expect(canAdvanceWizard(2, false, { slotCount: 0 })).toBe(false);
    expect(canAdvanceWizard(2, false, { slotCount: 1 })).toBe(true);
  });

  it("never blocks a trip poll on slot count", () => {
    expect(canAdvanceWizard(1, true, { slotCount: 0 })).toBe(true);
  });

  it("summarises the poll on the final step", () => {
    expect(
      wizardReviewLine({ title: " Ski weekend ", rangeLabel: "Aug 12 – Aug 18", slotCount: 3, isTrip: false }),
    ).toBe("Ski weekend · Aug 12 – Aug 18 · 3 time slots");
    expect(wizardReviewLine({ title: "", rangeLabel: "Aug 12 – Aug 18", slotCount: 1, isTrip: false })).toBe(
      "Find the Best Time · Aug 12 – Aug 18 · 1 time slot",
    );
    expect(wizardReviewLine({ title: "Trip", rangeLabel: "Aug 12 – Aug 18", slotCount: 1, isTrip: true })).toBe(
      "Trip · Aug 12 – Aug 18 · all-day",
    );
  });
});

describe("cross-period slot visibility", () => {
  it("orders selections by clock time regardless of insertion order", () => {
    expect(sortSlotsChronologically(new Set(["9PM", "7AM", "12AM", "12PM"]))).toEqual([
      "12AM",
      "7AM",
      "12PM",
      "9PM",
    ]);
  });

  it("de-duplicates and pushes unknown slots to the end", () => {
    expect(sortSlotsChronologically(["8PM", "8PM", "All day", "6AM"])).toEqual(["6AM", "8PM", "All day"]);
  });

  it("maps slots to their period tab", () => {
    expect(periodForSlot("2AM")).toBe("Night");
    expect(periodForSlot("9AM")).toBe("Morning");
    expect(periodForSlot("3PM")).toBe("Afternoon");
    expect(periodForSlot("8PM")).toBe("Evening");
    expect(periodForSlot("All day")).toBeNull();
  });

  it("counts selections hidden behind other period tabs", () => {
    const selected = new Set(["7AM", "8PM", "9PM"]);
    // Evening tab open → the 7AM pick is off-screen.
    expect(selectionsOutsidePeriod(selected, "Evening")).toBe(1);
    // Morning tab open → both evening picks are off-screen.
    expect(selectionsOutsidePeriod(selected, "Morning")).toBe(2);
    expect(selectionsOutsidePeriod(new Set(DEFAULT_SLOTS), "Evening")).toBe(0);
  });
});

describe("organizer edit loss", () => {
  const memberCells = [
    { userId: "u1", cells: ["2026-08-12-6PM", "2026-08-13-7PM"] },
    { userId: "u2", cells: ["2026-08-13-7PM"] },
    { userId: "u3", cells: ["2026-08-14-8PM"] },
  ];

  it("reports nothing dropped when the new grid still covers every selection", () => {
    const loss = computeTrimLoss({
      memberCells,
      nextDays: ["2026-08-12", "2026-08-13", "2026-08-14"],
      nextSlots: ["6PM", "7PM", "8PM"],
    });
    expect(loss).toEqual({ droppedSelections: 0, affectedUserIds: [], affectedPeople: 0 });
  });

  it("counts selections and distinct people lost when the range shrinks", () => {
    const loss = computeTrimLoss({
      memberCells,
      nextDays: ["2026-08-13"],
      nextSlots: ["6PM", "7PM", "8PM"],
    });
    // u1 loses its 8/12 pick, u3 loses its only pick; u2 is untouched.
    expect(loss.droppedSelections).toBe(2);
    expect(loss.affectedPeople).toBe(2);
    expect(loss.affectedUserIds.sort()).toEqual(["u1", "u3"]);
  });

  it("counts losses when slots are removed even if every day is kept", () => {
    const loss = computeTrimLoss({
      memberCells,
      nextDays: ["2026-08-12", "2026-08-13", "2026-08-14"],
      nextSlots: ["6PM"],
    });
    expect(loss.droppedSelections).toBe(3);
    expect(loss.affectedPeople).toBe(3);
  });

  it("counts a person once no matter how many of their picks are dropped", () => {
    const loss = computeTrimLoss({
      memberCells: [{ userId: "u1", cells: ["2026-08-12-6PM", "2026-08-12-7PM", "2026-08-12-8PM"] }],
      nextDays: ["2026-08-13"],
      nextSlots: ["6PM", "7PM", "8PM"],
    });
    expect(loss.droppedSelections).toBe(3);
    expect(loss.affectedPeople).toBe(1);
  });

  it("falls back to heatmap counts when per-member cells are absent", () => {
    const { droppedSelections } = computeTrimLossFromHeatmap({
      heatmap: [
        { cell: "2026-08-12-6PM", count: 4 },
        { cell: "2026-08-13-7PM", count: 2 },
      ],
      nextDays: ["2026-08-13"],
      nextSlots: ["7PM"],
    });
    expect(droppedSelections).toBe(4);
  });

  it("treats missing member cells as no measurable loss", () => {
    expect(computeTrimLoss({ memberCells: null, nextDays: [], nextSlots: [] }).droppedSelections).toBe(0);
  });

  it("pluralises the confirmation message and explains the responded state", () => {
    expect(trimLossMessage({ droppedSelections: 1, affectedUserIds: ["u1"], affectedPeople: 1 })).toContain(
      "1 selection from 1 person",
    );
    const many = trimLossMessage({ droppedSelections: 3, affectedUserIds: ["u1", "u2"], affectedPeople: 2 });
    expect(many).toContain("3 selections from 2 people");
    expect(many).toContain("still show as having responded");
  });
});

describe("save button state", () => {
  it("distinguishes never-saved from just-saved", () => {
    expect(saveButtonState({ dirty: false, saving: false, justSaved: false })).toEqual({
      label: "Save your times",
      disabled: true,
    });
    expect(saveButtonState({ dirty: false, saving: false, justSaved: true })).toEqual({
      label: "Saved ✓",
      disabled: true,
    });
  });

  it("enables the button only while there are unsaved changes", () => {
    expect(saveButtonState({ dirty: true, saving: false, justSaved: false })).toEqual({
      label: "Save",
      disabled: false,
    });
  });

  it("shows the in-flight state and blocks double submits", () => {
    expect(saveButtonState({ dirty: true, saving: true, justSaved: false })).toEqual({
      label: "Saving…",
      disabled: true,
    });
  });
});

describe("follow-up list and nudge eligibility", () => {
  const pending = { id: "p", hasResponded: false, needsUpdate: false };
  const stale = { id: "s", hasResponded: true, needsUpdate: true };
  const current = { id: "c", hasResponded: true, needsUpdate: false };

  it("classifies each member exactly once", () => {
    expect(memberFollowUpState(pending)).toBe("pending");
    expect(memberFollowUpState(stale)).toBe("stale");
    expect(memberFollowUpState(current)).toBe("current");
  });

  it("only offers Nudge for members the server will accept (no response row)", () => {
    expect(canNudgeMember(pending, true)).toBe(true);
    // The server rejects a nudge for someone who already has a response row.
    expect(canNudgeMember(stale, true)).toBe(false);
    expect(canNudgeMember(current, true)).toBe(false);
  });

  it("never offers Nudge to non-creators", () => {
    expect(canNudgeMember(pending, false)).toBe(false);
  });

  it("lists everyone outstanding once, never-responded first", () => {
    const list = buildFollowUpList([current, stale, pending]);
    expect(list.map((m) => m.id)).toEqual(["p", "s"]);
  });

  it("returns an empty list when everyone is up to date", () => {
    expect(buildFollowUpList([current])).toEqual([]);
  });

  it("labels each follow-up state", () => {
    expect(followUpStateLabel("pending")).toBe("Hasn't responded yet");
    expect(followUpStateLabel("stale")).toBe("Responded before the date change");
  });
});

describe("alternate-time picker ranking", () => {
  const days = ["2026-08-12", "2026-08-13"];
  const slots = ["6PM", "7PM"];

  it("ranks the poll's own cells by response count, best first", () => {
    const ranked = rankPollCells({
      heatmap: [
        { cell: "2026-08-12-6PM", count: 1 },
        { cell: "2026-08-13-7PM", count: 3 },
        { cell: "2026-08-12-7PM", count: 2 },
      ],
      days,
      slots,
    });
    expect(ranked.map((r) => r.cell)).toEqual(["2026-08-13-7PM", "2026-08-12-7PM", "2026-08-12-6PM"]);
  });

  it("breaks ties chronologically using the poll's declared order", () => {
    const ranked = rankPollCells({
      heatmap: [
        { cell: "2026-08-13-6PM", count: 2 },
        { cell: "2026-08-12-7PM", count: 2 },
        { cell: "2026-08-12-6PM", count: 2 },
      ],
      days,
      slots,
    });
    expect(ranked.map((r) => r.cell)).toEqual(["2026-08-12-6PM", "2026-08-12-7PM", "2026-08-13-6PM"]);
  });

  it("omits cells nobody picked", () => {
    const ranked = rankPollCells({
      heatmap: [{ cell: "2026-08-12-6PM", count: 1 }],
      days,
      slots,
    });
    expect(ranked).toEqual([{ cell: "2026-08-12-6PM", count: 1 }]);
  });

  it("ignores heatmap cells that are no longer part of the poll grid", () => {
    const ranked = rankPollCells({
      heatmap: [
        { cell: "2026-08-30-9PM", count: 9 },
        { cell: "2026-08-12-6PM", count: 1 },
      ],
      days,
      slots,
    });
    expect(ranked.map((r) => r.cell)).toEqual(["2026-08-12-6PM"]);
  });

  it("returns nothing when there are no responses at all", () => {
    expect(rankPollCells({ heatmap: [], days, slots })).toEqual([]);
  });
});

describe("poll entry points", () => {
  it("reports responses against the eligible member count when known", () => {
    expect(pollStatusLabel({ respondentCount: 2, memberCount: 5 })).toBe("2 of 5 responded");
    expect(pollStatusLabel({ respondentCount: 1, memberCount: 0 })).toBe("1 response");
    expect(pollStatusLabel({ respondentCount: 3, memberCount: 0 })).toBe("3 responses");
  });
});

describe("which result a poll board may show", () => {
  // The trap: the server keeps sending the single-cell `best` on trip polls for
  // backwards compatibility, so a naive `bestStretch ?? best` announces ONE DAY
  // as the winner of a multi-day trip.
  it("shows the stretch whenever there is one", () => {
    expect(pollResultKind({ hasStretch: true, hasBest: true, tripLengthDays: 3 })).toBe("stretch");
    expect(pollResultKind({ hasStretch: true, hasBest: false, tripLengthDays: 3 })).toBe("stretch");
  });

  it("shows NOTHING rather than a single day when a length-aware trip has no stretch", () => {
    expect(pollResultKind({ hasStretch: false, hasBest: true, tripLengthDays: 3 })).toBe("none");
  });

  it("still shows the single cell for event polls", () => {
    expect(pollResultKind({ hasStretch: false, hasBest: true, tripLengthDays: null })).toBe("cell");
  });

  it("still shows the single cell for legacy trips with no recorded length", () => {
    // These polls never chose a length, so their original single-best-day
    // answer is the only honest one available.
    expect(pollResultKind({ hasStretch: false, hasBest: true, tripLengthDays: null })).toBe("cell");
  });

  it("shows nothing when there is no result at all", () => {
    expect(pollResultKind({ hasStretch: false, hasBest: false, tripLengthDays: 3 })).toBe("none");
    expect(pollResultKind({ hasStretch: false, hasBest: false, tripLengthDays: null })).toBe("none");
  });
});

describe("winner nudge honesty", () => {
  const stretch = (count: number, partial: boolean) => ({ count, partial });

  it("nudges a trip only for a complete stretch that works for 2+", () => {
    expect(
      shouldNudgePollWinner({ isCreator: true, tripLengthDays: 3, stretch: stretch(2, false), best: null }),
    ).toBe(true);
  });

  it("never nudges on a partial stretch", () => {
    // "You've got a winner!" for dates nobody can fully make is the exact
    // dishonesty the partial flag exists to prevent.
    expect(
      shouldNudgePollWinner({ isCreator: true, tripLengthDays: 3, stretch: stretch(0, true), best: { count: 5 } }),
    ).toBe(false);
  });

  it("never falls back to the single-cell best on a length-aware trip", () => {
    expect(
      shouldNudgePollWinner({ isCreator: true, tripLengthDays: 3, stretch: null, best: { count: 4 } }),
    ).toBe(false);
  });

  it("does not nudge when only one person is free for the run", () => {
    expect(
      shouldNudgePollWinner({ isCreator: true, tripLengthDays: 3, stretch: stretch(1, false), best: null }),
    ).toBe(false);
  });

  it("keeps the single-cell nudge for event and legacy-trip polls", () => {
    expect(
      shouldNudgePollWinner({ isCreator: true, tripLengthDays: null, stretch: null, best: { count: 2 } }),
    ).toBe(true);
    expect(
      shouldNudgePollWinner({ isCreator: true, tripLengthDays: null, stretch: null, best: { count: 1 } }),
    ).toBe(false);
  });

  it("never nudges a non-creator", () => {
    expect(
      shouldNudgePollWinner({ isCreator: false, tripLengthDays: 3, stretch: stretch(5, false), best: null }),
    ).toBe(false);
    expect(
      shouldNudgePollWinner({ isCreator: false, tripLengthDays: null, stretch: null, best: { count: 5 } }),
    ).toBe(false);
  });
});

describe("editing a LEGACY trip poll (no stored length)", () => {
  // A legacy trip has tripLengthDays === null and must keep its original
  // single-best-day behavior. Opening the editor must not invent a length:
  // seeding the control with the default made an untouched sheet report dirty,
  // warn "unsaved changes" on Cancel, and PATCH a duration on Save — silently
  // converting the poll to stretch-ranking the host never asked for.
  const LEGACY_DAYS = 10;

  const openSheet = (loadedTripLength: number | null) => {
    const editTripLength = initialEditTripLength(loadedTripLength, LEGACY_DAYS);
    const baseline = editRangeSnapshot({
      startISO: "2026-03-01",
      days: LEGACY_DAYS,
      slots: ["All day"],
      title: "Ski trip",
      tripLengthDays: loadedTripLength,
    });
    return { editTripLength, baseline };
  };

  const snapshotOf = (editTripLength: number | null) =>
    editRangeSnapshot({
      startISO: "2026-03-01",
      days: LEGACY_DAYS,
      slots: ["All day"],
      title: "Ski trip",
      tripLengthDays: editTripLength,
    });

  it("opens with NO length selected instead of defaulting to one", () => {
    expect(openSheet(null).editTripLength).toBeNull();
  });

  it("is not dirty when the host opens the sheet and changes nothing", () => {
    const { editTripLength, baseline } = openSheet(null);
    // This is the Cancel path: an untouched sheet must not warn about
    // discarding changes the host never made.
    expect(editRangeDirty(snapshotOf(editTripLength), baseline)).toBe(false);
    expect(editChangesGrid(snapshotOf(editTripLength), baseline)).toBe(false);
  });

  it("omits tripLengthDays from the PATCH so the poll stays length-less", () => {
    const { editTripLength } = openSheet(null);
    expect(
      editTripLengthPatchValue({ isTrip: true, editTripLength, editDays: LEGACY_DAYS }),
    ).toBeUndefined();
  });

  it("sends a length only once the host deliberately picks one", () => {
    const { editTripLength, baseline } = openSheet(null);
    expect(editTripLength).toBeNull();
    // Host taps the "4 days" chip.
    const chosen = 4;
    expect(editRangeDirty(snapshotOf(chosen), baseline)).toBe(true);
    // Giving a legacy trip a length re-ranks it; it does not touch the grid, so
    // it must not trigger the destructive answer-loss confirmation.
    expect(editChangesGrid(snapshotOf(chosen), baseline)).toBe(false);
    expect(
      editTripLengthPatchValue({ isTrip: true, editTripLength: chosen, editDays: LEGACY_DAYS }),
    ).toBe(chosen);
  });

  it("still round-trips a length-aware trip untouched", () => {
    const { editTripLength, baseline } = openSheet(3);
    expect(editTripLength).toBe(3);
    expect(editRangeDirty(snapshotOf(editTripLength), baseline)).toBe(false);
    expect(
      editTripLengthPatchValue({ isTrip: true, editTripLength, editDays: LEGACY_DAYS }),
    ).toBe(3);
  });

  it("clamps a stored length that no longer fits a shrunken window", () => {
    expect(initialEditTripLength(10, 4)).toBe(4);
    // …but a length-less trip stays length-less no matter the window.
    expect(initialEditTripLength(null, 4)).toBeNull();
  });

  it("never sends a length for an event poll", () => {
    expect(
      editTripLengthPatchValue({ isTrip: false, editTripLength: 5, editDays: LEGACY_DAYS }),
    ).toBeUndefined();
  });
});
