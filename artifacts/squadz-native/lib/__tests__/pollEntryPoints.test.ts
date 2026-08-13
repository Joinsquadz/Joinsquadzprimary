// Regression coverage for the "Find the Best Time" flow-safety rules:
// inline poll capping, wizard-abandonment detection, and edit-range dirty
// state. These helpers are React-free (see lib/pollWizard.ts) so they run under
// the node-environment vitest config without loading react-native.
import { describe, it, expect } from "vitest";

import {
  INLINE_POLL_CAP,
  splitInlinePolls,
  wizardHasInput,
  editRangeSnapshot,
  editRangeDirty,
  DEFAULT_DAY_COUNT,
  DEFAULT_SLOTS,
} from "../pollWizard";

describe("inline active-poll capping", () => {
  const polls = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `poll-${i}` }));

  it("shows every poll and hides none while under the cap", () => {
    const { visible, hiddenCount } = splitInlinePolls(polls(2));
    expect(visible.map((p) => p.id)).toEqual(["poll-0", "poll-1"]);
    expect(hiddenCount).toBe(0);
  });

  it("shows exactly the cap with nothing hidden at the boundary", () => {
    const { visible, hiddenCount } = splitInlinePolls(polls(INLINE_POLL_CAP));
    expect(visible).toHaveLength(INLINE_POLL_CAP);
    // Off-by-one here renders a "See all 0 polls" row.
    expect(hiddenCount).toBe(0);
  });

  it("caps the list and reports the remainder once there are more", () => {
    const { visible, hiddenCount } = splitInlinePolls(polls(7));
    expect(visible).toHaveLength(INLINE_POLL_CAP);
    expect(hiddenCount).toBe(7 - INLINE_POLL_CAP);
  });

  it("never reports a negative hidden count for an empty scope", () => {
    expect(splitInlinePolls([])).toEqual({ visible: [], hiddenCount: 0 });
  });
});

describe("wizard abandonment guard", () => {
  const TODAY = "2026-06-10";
  const untouched = {
    title: "",
    stepIndex: 0,
    rangeDays: DEFAULT_DAY_COUNT,
    rangeStartISO: TODAY,
    todayISO: TODAY,
  };

  it("stays silent for an untouched wizard", () => {
    // Someone who taps in and straight back out must not be interrogated.
    expect(wizardHasInput(untouched)).toBe(false);
  });

  it("treats a title, a step forward, a changed length or a moved start as input", () => {
    expect(wizardHasInput({ ...untouched, title: "Dinner" })).toBe(true);
    expect(wizardHasInput({ ...untouched, stepIndex: 1 })).toBe(true);
    expect(wizardHasInput({ ...untouched, rangeDays: DEFAULT_DAY_COUNT + 7 })).toBe(true);
    expect(wizardHasInput({ ...untouched, rangeStartISO: "2026-06-17" })).toBe(true);
  });

  it("ignores a whitespace-only title", () => {
    expect(wizardHasInput({ ...untouched, title: "   " })).toBe(false);
  });

  it("compares calendar days, not timestamps", () => {
    // The default start is "now", so a timestamp comparison would flip to dirty
    // as soon as the clock moved past the render that created it — every exit
    // would prompt.
    expect(wizardHasInput({ ...untouched, rangeStartISO: TODAY, todayISO: TODAY })).toBe(false);
  });
});

describe("edit-range discard guard", () => {
  const baseline = editRangeSnapshot({
    startISO: "2026-06-20",
    days: 7,
    slots: DEFAULT_SLOTS,
    title: "When are you free?",
  });

  it("is clean when the sheet is closed exactly as it opened", () => {
    const current = editRangeSnapshot({
      startISO: "2026-06-20",
      days: 7,
      slots: DEFAULT_SLOTS,
      title: "When are you free?",
    });
    expect(editRangeDirty(current, baseline)).toBe(false);
  });

  it("ignores slot re-ordering — the same set is not a change", () => {
    const current = editRangeSnapshot({
      startISO: "2026-06-20",
      days: 7,
      slots: [...DEFAULT_SLOTS].reverse(),
      title: "When are you free?",
    });
    expect(editRangeDirty(current, baseline)).toBe(false);
  });

  it("catches a moved start, a changed length, changed slots and a retitle", () => {
    const change = (over: Partial<Parameters<typeof editRangeSnapshot>[0]>) =>
      editRangeDirty(
        editRangeSnapshot({
          startISO: "2026-06-20",
          days: 7,
          slots: DEFAULT_SLOTS,
          title: "When are you free?",
          ...over,
        }),
        baseline,
      );

    expect(change({ startISO: "2026-06-27" })).toBe(true);
    expect(change({ days: 14 })).toBe(true);
    expect(change({ slots: [...DEFAULT_SLOTS, "11PM"] })).toBe(true);
    expect(change({ title: "New title" })).toBe(true);
  });

  it("is clean with no baseline — the sheet never opened", () => {
    const current = editRangeSnapshot({
      startISO: "2026-06-20",
      days: 7,
      slots: DEFAULT_SLOTS,
      title: "x",
    });
    expect(editRangeDirty(current, null)).toBe(false);
  });
});
