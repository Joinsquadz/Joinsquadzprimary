// Pure helpers for the "Find the Best Time" poll wizard, editing, pending/nudge
// UI and result actions. Everything here is deliberately free of React and
// react-native imports so it can be unit-tested under the node-environment
// vitest config (see vitest.config.ts).

// ---- Slot / range constants (single source for the screen + tests) ----

export const DAY_COUNT_OPTIONS = [3, 5, 7, 14, 21, 30];
export const DEFAULT_DAY_COUNT = 7;

export const ALL_SLOT_OPTIONS: string[] = [
  "12AM","1AM","2AM","3AM","4AM","5AM",
  "6AM","7AM","8AM","9AM","10AM","11AM",
  "12PM","1PM","2PM","3PM","4PM","5PM",
  "6PM","7PM","8PM","9PM","10PM","11PM",
];

export const DEFAULT_SLOTS: string[] = ["6PM","7PM","8PM","9PM","10PM"];

// Trip polls are date-range focused: a single "All day" slot collapses the grid
// to one per-day toggle so people just mark which dates they can travel.
export const TRIP_SLOT = "All day";
export const TRIP_SLOTS: string[] = [TRIP_SLOT];

export const SLOT_PERIODS: { label: string; slots: string[] }[] = [
  { label: "Night",     slots: ["12AM","1AM","2AM","3AM","4AM","5AM"] },
  { label: "Morning",   slots: ["6AM","7AM","8AM","9AM","10AM","11AM"] },
  { label: "Afternoon", slots: ["12PM","1PM","2PM","3PM","4PM","5PM"] },
  { label: "Evening",   slots: ["6PM","7PM","8PM","9PM","10PM","11PM"] },
];

const SLOT_ORDER = new Map(ALL_SLOT_OPTIONS.map((s, i) => [s, i]));

/**
 * Chronological ordering for an arbitrary set of selected slots.
 *
 * The wizard's period tabs only ever render one period at a time, so the
 * persistent "current selections" chip row is the ONLY place a user can see a
 * selection made under a different tab. It must therefore be stable and
 * ordered by clock time, not by insertion order.
 */
export function sortSlotsChronologically(slots: Iterable<string>): string[] {
  return [...new Set(slots)].sort((a, b) => {
    const ia = SLOT_ORDER.get(a);
    const ib = SLOT_ORDER.get(b);
    if (ia === undefined && ib === undefined) return a.localeCompare(b);
    if (ia === undefined) return 1;
    if (ib === undefined) return -1;
    return ia - ib;
  });
}

/** Which period tab a slot belongs to (null for non-standard slots, e.g. "All day"). */
export function periodForSlot(slot: string): string | null {
  for (const p of SLOT_PERIODS) {
    if (p.slots.includes(slot)) return p.label;
  }
  return null;
}

/**
 * Count how many of the current selections live outside the period tab that is
 * currently open. Drives the "N selected on other tabs" hint so the count is
 * never the only signal that off-screen selections exist.
 */
export function selectionsOutsidePeriod(slots: Iterable<string>, period: string): number {
  let n = 0;
  for (const s of new Set(slots)) {
    if (periodForSlot(s) !== period) n++;
  }
  return n;
}

// ---- Wizard step machine ----

export type WizardStepId = "name" | "dates" | "times";

export type WizardStep = { id: WizardStepId; label: string };

/**
 * Trip polls have no time-slot step at all (the grid is a single "All day"
 * row), so the machine is 2 steps there and 3 for event polls.
 */
export function pollWizardSteps(isTrip: boolean): WizardStep[] {
  const steps: WizardStep[] = [
    { id: "name", label: "Name" },
    { id: "dates", label: "Dates" },
  ];
  if (!isTrip) steps.push({ id: "times", label: "Times" });
  return steps;
}

export function isLastWizardStep(index: number, isTrip: boolean): boolean {
  return index >= pollWizardSteps(isTrip).length - 1;
}

export function nextWizardStep(index: number, isTrip: boolean): number {
  return Math.min(index + 1, pollWizardSteps(isTrip).length - 1);
}

export function prevWizardStep(index: number): number {
  return Math.max(0, index - 1);
}

/** True when back should exit the flow entirely rather than step backwards. */
export function wizardBackExits(index: number): boolean {
  return index <= 0;
}

/**
 * Step 1 (title) is always skippable — the server defaults the title. Step 3
 * requires at least one slot so the poll can never be created with an empty
 * grid.
 */
export function canAdvanceWizard(
  index: number,
  isTrip: boolean,
  values: { slotCount: number },
): boolean {
  const step = pollWizardSteps(isTrip)[index];
  if (!step) return false;
  if (step.id === "times") return values.slotCount > 0;
  return true;
}

/** Compact review line shown on the final step. */
export function wizardReviewLine(v: {
  title: string;
  rangeLabel: string;
  slotCount: number;
  isTrip: boolean;
}): string {
  const title = v.title.trim() || "Find the Best Time";
  if (v.isTrip) return `${title} · ${v.rangeLabel} · all-day`;
  return `${title} · ${v.rangeLabel} · ${v.slotCount} ${v.slotCount === 1 ? "time slot" : "time slots"}`;
}

// ---- Edit loss confirmation ----

export type MemberCells = { userId: string; cells: string[] };

export type TrimLoss = {
  droppedSelections: number;
  affectedUserIds: string[];
  affectedPeople: number;
};

/**
 * Compute what an organizer's range/slot edit will silently delete.
 *
 * The server already trims out-of-grid cells by stable `<day>-<slot>` identity
 * (and deliberately preserves each response's `updatedAt` so trimmed members
 * still count as having responded). That trim is silent, so we mirror the same
 * stable-identity rule here purely to warn BEFORE the write.
 */
export function computeTrimLoss(input: {
  memberCells?: MemberCells[] | null;
  nextDays: string[];
  nextSlots: string[];
}): TrimLoss {
  const valid = new Set<string>();
  for (const day of input.nextDays) {
    for (const slot of input.nextSlots) valid.add(`${day}-${slot}`);
  }
  let droppedSelections = 0;
  const affected = new Set<string>();
  for (const mc of input.memberCells ?? []) {
    for (const cell of mc.cells) {
      if (!valid.has(cell)) {
        droppedSelections++;
        affected.add(mc.userId);
      }
    }
  }
  return {
    droppedSelections,
    affectedUserIds: [...affected],
    affectedPeople: affected.size,
  };
}

/**
 * Fallback when per-member cells aren't in the payload: the heatmap still tells
 * us how many selections sit on each cell, so we can report the dropped-count
 * even though we can't attribute it to people.
 */
export function computeTrimLossFromHeatmap(input: {
  heatmap: { cell: string; count: number }[];
  nextDays: string[];
  nextSlots: string[];
}): { droppedSelections: number } {
  const valid = new Set<string>();
  for (const day of input.nextDays) {
    for (const slot of input.nextSlots) valid.add(`${day}-${slot}`);
  }
  let droppedSelections = 0;
  for (const h of input.heatmap) {
    if (!valid.has(h.cell)) droppedSelections += h.count;
  }
  return { droppedSelections };
}

export function trimLossMessage(loss: TrimLoss): string {
  const s = loss.droppedSelections;
  const p = loss.affectedPeople;
  return (
    `${s} ${s === 1 ? "selection" : "selections"} from ` +
    `${p} ${p === 1 ? "person" : "people"} fall outside the new range and will be removed. ` +
    `They'll still show as having responded, so you can nudge them to re-enter their times.`
  );
}

// ---- Save button state machine ----

export type SaveUiState = { label: string; disabled: boolean };

/**
 * Three honest states. The old UI said "Saved" whenever `dirty === false`,
 * including before the user had ever written anything.
 */
export function saveButtonState(o: {
  dirty: boolean;
  saving: boolean;
  justSaved: boolean;
}): SaveUiState {
  if (o.saving) return { label: "Saving…", disabled: true };
  if (o.dirty) return { label: "Save", disabled: false };
  if (o.justSaved) return { label: "Saved ✓", disabled: true };
  return { label: "Save your times", disabled: true };
}

// ---- Pending / nudge unification ----

export type PendingMember = {
  id: string;
  hasResponded: boolean;
  needsUpdate: boolean;
};

export type MemberFollowUpState = "pending" | "stale" | "current";

export function memberFollowUpState(m: PendingMember): MemberFollowUpState {
  if (!m.hasResponded) return "pending";
  if (m.needsUpdate) return "stale";
  return "current";
}

/**
 * The server only accepts a nudge for a member with NO response row. The old
 * "Still needs to update" card offered a Nudge button to members who had
 * responded before an organizer edit — the server rejects those with 400.
 * The button must only render where the server will actually accept it.
 */
export function canNudgeMember(m: PendingMember, isCreator: boolean): boolean {
  return isCreator && memberFollowUpState(m) === "pending";
}

/**
 * One unified follow-up list: everyone who still owes the organizer something,
 * never-responded first, each appearing exactly once.
 */
export function buildFollowUpList<T extends PendingMember>(members: T[]): T[] {
  return members
    .filter((m) => memberFollowUpState(m) !== "current")
    .sort((a, b) => {
      const rank = (m: T) => (memberFollowUpState(m) === "pending" ? 0 : 1);
      return rank(a) - rank(b);
    });
}

export function followUpStateLabel(state: MemberFollowUpState): string {
  if (state === "pending") return "Hasn't responded yet";
  if (state === "stale") return "Responded before the date change";
  return "Up to date";
}

// ---- Alternate-slot picker ----

export type RankedCell = { cell: string; count: number };

/**
 * Options for the in-poll "pick a different time" sheet: the poll's OWN cells
 * with their response counts, best first, ties broken chronologically by the
 * poll's declared day/slot order so the list is deterministic.
 */
export function rankPollCells(input: {
  heatmap: { cell: string; count: number }[];
  days: string[];
  slots: string[];
  minCount?: number;
}): RankedCell[] {
  const dayOrder = new Map(input.days.map((d, i) => [d, i]));
  const slotOrder = new Map(input.slots.map((s, i) => [s, i]));
  const min = input.minCount ?? 1;
  const counts = new Map(input.heatmap.map((h) => [h.cell, h.count]));

  const out: RankedCell[] = [];
  for (const day of input.days) {
    for (const slot of input.slots) {
      const cell = `${day}-${slot}`;
      const count = counts.get(cell) ?? 0;
      if (count >= min) out.push({ cell, count });
    }
  }
  return out.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const [ad, as] = splitByLastDash(a.cell);
    const [bd, bs] = splitByLastDash(b.cell);
    const dd = (dayOrder.get(ad) ?? 0) - (dayOrder.get(bd) ?? 0);
    if (dd !== 0) return dd;
    return (slotOrder.get(as) ?? 0) - (slotOrder.get(bs) ?? 0);
  });
}

function splitByLastDash(cell: string): [string, string] {
  const i = cell.lastIndexOf("-");
  if (i < 0) return [cell, ""];
  return [cell.slice(0, i), cell.slice(i + 1)];
}

// ---- Resume-first entry points ----

export type ActivePollSummary = { id: string };

export type ResumeDecision =
  | { action: "create" }
  | { action: "resume"; pollId: string }
  | { action: "choose" };

/**
 * Resume-first rule for the squad / New Event CTAs.
 *
 * Exactly one active poll resumes directly; more than one opens the chooser so
 * no active poll is silently unreachable (the squad CTA used to resolve only
 * the newest via /find while the chooser listed them all).
 */
export function resolveResumeAction(polls: ActivePollSummary[]): ResumeDecision {
  if (polls.length === 0) return { action: "create" };
  if (polls.length === 1) return { action: "resume", pollId: polls[0].id };
  return { action: "choose" };
}

/** Live "responses received out of eligible members" label for the CTA. */
export function pollStatusLabel(o: { respondentCount: number; memberCount: number }): string {
  if (o.memberCount > 0) {
    return `${o.respondentCount} of ${o.memberCount} responded`;
  }
  return o.respondentCount === 1 ? "1 response" : `${o.respondentCount} responses`;
}
