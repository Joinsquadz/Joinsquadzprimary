// Pure helpers for the "Find the Best Time" poll wizard, editing, pending/nudge
// UI and result actions. Everything here is deliberately free of React and
// react-native imports so it can be unit-tested under the node-environment
// vitest config (see vitest.config.ts).

// ---- Slot / range constants (single source for the screen + tests) ----

export const DAY_COUNT_OPTIONS = [3, 5, 7, 14, 21, 30];
export const DEFAULT_DAY_COUNT = 7;
export const MIN_POLL_DAY_COUNT = 1;
export const MAX_POLL_DAY_COUNT = 31;

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

// How long the TRIP runs, which is a different question from how wide the
// voting window is: people vote across (say) three weeks so the squad can find
// the best four-day run inside it. Minimum 2 — a one-day "trip" is an event,
// and that's the poll type next to it in the flow.
export const MIN_TRIP_LENGTH_DAYS = 2;
export const DEFAULT_TRIP_LENGTH_DAYS = 3;
export const TRIP_LENGTH_OPTIONS = [2, 3, 4, 5, 7, 10, 14];

/** Whether a duration was chosen from a suggestion or entered deliberately. */
export type TimelineChoice = "preset" | "custom";

/**
 * A number alone is not enough to describe the UI choice: someone can enter
 * "7" under Custom even though 7 is also a suggested window. Keep the mode in
 * drafts so Back/Next restores the choice they made, not an inferred preset.
 */
export function timelineChoiceFor(
  value: number,
  presets: readonly number[],
  savedChoice?: TimelineChoice,
): TimelineChoice {
  return savedChoice ?? (presets.includes(value) ? "preset" : "custom");
}

/** Clear, client-side guidance that mirrors the API's supported poll limits. */
export function customDayCountError(raw: string): string | null {
  if (!/^\d+$/.test(raw.trim())) return "Enter a whole number of days.";
  const value = Number(raw);
  if (value < MIN_POLL_DAY_COUNT || value > MAX_POLL_DAY_COUNT) {
    return `Choose between ${MIN_POLL_DAY_COUNT} and ${MAX_POLL_DAY_COUNT} days.`;
  }
  return null;
}

/** Trip duration validation, including the voting-window relationship. */
export function customTripLengthError(raw: string, rangeDays: number): string | null {
  if (!/^\d+$/.test(raw.trim())) return "Enter a whole number of days.";
  const value = Number(raw);
  if (value < MIN_TRIP_LENGTH_DAYS) {
    return `A trip must be at least ${MIN_TRIP_LENGTH_DAYS} days.`;
  }
  if (value > MAX_POLL_DAY_COUNT) {
    return `Choose ${MAX_POLL_DAY_COUNT} days or fewer.`;
  }
  if (value > rangeDays) {
    return "The trip can't be longer than the dates people are voting on.";
  }
  return null;
}

/**
 * Trip lengths that fit inside a voting window of `rangeDays`. A trip longer
 * than the window has no stretch to rank at all, so those options are never
 * offered rather than being offered and then rejected by the server.
 */
export function tripLengthOptionsFor(rangeDays: number): number[] {
  return TRIP_LENGTH_OPTIONS.filter((n) => n <= rangeDays);
}

/**
 * Keep a chosen trip length legal when the voting window shrinks under it.
 * Clamps to the longest option that still fits (never below the minimum).
 */
export function clampTripLength(lengthDays: number, rangeDays: number): number {
  const max = Math.max(MIN_TRIP_LENGTH_DAYS, Math.min(rangeDays, MAX_POLL_DAY_COUNT));
  return Math.min(Math.max(lengthDays, MIN_TRIP_LENGTH_DAYS), max);
}

/**
 * What the edit sheet's length control should start on.
 *
 * A LEGACY trip poll has no stored length and must keep its original
 * single-best-day behavior until the host deliberately gives it one. Seeding
 * the control with a default instead of null meant simply opening the sheet
 * made it dirty, warned "unsaved changes" on Cancel, and let Save convert the
 * poll to stretch-ranking that the host never asked for. Null stays null.
 */
export function initialEditTripLength(
  loadedTripLength: number | null,
  rangeDays: number,
): number | null {
  if (loadedTripLength === null) return null;
  return clampTripLength(loadedTripLength, rangeDays);
}

/**
 * The `tripLengthDays` to PATCH, or undefined to omit the field entirely.
 *
 * Omission is meaningful: it is what preserves a length-less legacy trip. Event
 * polls never send a length (the server rejects it).
 */
export function editTripLengthPatchValue(v: {
  isTrip: boolean;
  editTripLength: number | null;
  editDays: number;
}): number | undefined {
  if (!v.isTrip || v.editTripLength === null) return undefined;
  return clampTripLength(v.editTripLength, v.editDays);
}

/** Server-side rule, mirrored so the wizard can't offer an impossible poll. */
export function isValidTripLength(lengthDays: number, rangeDays: number): boolean {
  return (
    Number.isInteger(lengthDays) &&
    lengthDays >= MIN_TRIP_LENGTH_DAYS &&
    lengthDays <= rangeDays
  );
}

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

export type WizardStepId = "name" | "dates" | "times" | "length";

export type WizardStep = { id: WizardStepId; label: string };

/**
 * Both poll types are 3 steps, but the last one asks a different question.
 *
 * Event polls need the time slots people vote on. Trip polls have no time-slot
 * step (the grid is a single "All day" row) — instead they need how many days
 * the trip runs, which is what turns the voting window into a rankable set of
 * consecutive stretches. Without it a trip poll can only answer "which single
 * day suits most people", which is not the question a trip asks.
 */
export function pollWizardSteps(isTrip: boolean): WizardStep[] {
  const steps: WizardStep[] = [
    { id: "name", label: "Name" },
    { id: "dates", label: "Dates" },
  ];
  steps.push(isTrip ? { id: "length", label: "Length" } : { id: "times", label: "Times" });
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
 * Has the user actually put work into the creation wizard?
 *
 * Drafts persist per scope, so leaving doesn't destroy the answers — but
 * walking out of a half-built poll with no acknowledgement reads as "that got
 * thrown away", and on the last step it's one tap away from a poll that was
 * never created. Only REAL input counts: an untouched wizard (today's date, the
 * default day count, no title, step 0) must still leave instantly, or every
 * accidental tap into the flow turns into a confirm dialog.
 *
 * Dates are compared as calendar days, not timestamps — the default start is
 * "now", so a raw Date comparison would report dirty the moment the clock
 * ticked past the render that created it.
 */
export function wizardHasInput(v: {
  title: string;
  stepIndex: number;
  rangeDays: number;
  rangeStartISO: string;
  todayISO: string;
  /** Trip polls only — omitted (or left at the default) counts as untouched. */
  tripLengthDays?: number;
}): boolean {
  return (
    v.title.trim().length > 0 ||
    v.stepIndex > 0 ||
    v.rangeDays !== DEFAULT_DAY_COUNT ||
    v.rangeStartISO !== v.todayISO ||
    (v.tripLengthDays !== undefined && v.tripLengthDays !== DEFAULT_TRIP_LENGTH_DAYS)
  );
}

/** What the edit-range sheet opened with, for a cheap dirty comparison. */
export type EditRangeSnapshot = {
  startISO: string;
  days: number;
  /** Sorted + joined so slot ordering can't fake a change. */
  slots: string;
  title: string;
  /** Trip length, or null on an event poll. */
  tripLengthDays: number | null;
};

export function editRangeSnapshot(v: {
  startISO: string;
  days: number;
  slots: Iterable<string>;
  title: string;
  tripLengthDays?: number | null;
}): EditRangeSnapshot {
  return {
    startISO: v.startISO,
    days: v.days,
    slots: [...new Set(v.slots)].sort().join("|"),
    title: v.title,
    tripLengthDays: v.tripLengthDays ?? null,
  };
}

/**
 * True when the edit sheet holds changes that Cancel would silently discard.
 *
 * Cancelling used to drop a re-range the host had just dialled in — including
 * via a fat-fingered backdrop tap — so the sheet confirms only when something
 * really changed.
 */
export function editRangeDirty(
  current: EditRangeSnapshot,
  baseline: EditRangeSnapshot | null,
): boolean {
  if (!baseline) return false;
  return (
    current.startISO !== baseline.startISO ||
    current.days !== baseline.days ||
    current.slots !== baseline.slots ||
    current.title !== baseline.title ||
    current.tripLengthDays !== baseline.tripLengthDays
  );
}

/**
 * True when the pending edit changes the GRID (dates or slots) rather than just
 * re-ranking it.
 *
 * Changing only how long the trip is leaves every `<date>-All day` cell exactly
 * where it was — nothing can fall outside the grid, so there is nothing to trim
 * and nothing to warn about. Running the destructive-loss confirmation there
 * would tell the host their squad's answers are about to be deleted, which
 * would simply be untrue.
 */
export function editChangesGrid(
  current: EditRangeSnapshot,
  baseline: EditRangeSnapshot | null,
): boolean {
  if (!baseline) return false;
  return (
    current.startISO !== baseline.startISO ||
    current.days !== baseline.days ||
    current.slots !== baseline.slots
  );
}

/**
 * Step 1 (title) is always skippable — the server defaults the title. Step 3
 * requires at least one slot so the poll can never be created with an empty
 * grid.
 */
export function canAdvanceWizard(
  index: number,
  isTrip: boolean,
  values: { slotCount: number; tripLengthDays?: number; rangeDays?: number },
): boolean {
  const step = pollWizardSteps(isTrip)[index];
  if (!step) return false;
  if (step.id === "times") return values.slotCount > 0;
  if (step.id === "length") {
    // Guard the same rule the server enforces, so an impossible trip length
    // can't reach the create call and fail there.
    return isValidTripLength(values.tripLengthDays ?? 0, values.rangeDays ?? 0);
  }
  return true;
}

/** Compact review line shown on the final step. */
export function wizardReviewLine(v: {
  title: string;
  rangeLabel: string;
  slotCount: number;
  isTrip: boolean;
  tripLengthDays?: number;
}): string {
  const title = v.title.trim() || "Find the Best Time";
  if (v.isTrip) {
    // The window and the trip are two different spans, so name both — "all-day"
    // alone left people thinking the whole range was the trip.
    const n = v.tripLengthDays;
    return n
      ? `${title} · ${v.rangeLabel} · ${n}-day trip`
      : `${title} · ${v.rangeLabel} · all-day`;
  }
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

// ---- Trip stretch results ----

export type TripStretchResult = {
  startDate: string;
  endDate: string;
  lengthDays: number;
  /** People free for EVERY day of the stretch. */
  count: number;
  /** People free for at least one day of it. */
  partialCount: number;
  total: number;
  /** True when nobody clears the whole stretch — a least-bad window, not a win. */
  partial: boolean;
};

/**
 * Client-side mirror of the server's stretch ranking, used for the creator's
 * "start the trip on this day" pick in the grid so the sheet can show what that
 * choice actually costs before they commit to it.
 *
 * Kept in step with artifacts/api-server/src/lib/tripStretch.ts: rank by the
 * number of people free for the WHOLE run, tie-break by earliest start, and
 * fall back to total person-days (flagged `partial`) when no run works for
 * anyone end-to-end.
 */
export function tripStretchFor(input: {
  days: string[];
  lengthDays: number;
  memberCells: MemberCells[];
  startDate: string;
}): TripStretchResult | null {
  const idx = input.days.indexOf(input.startDate);
  if (idx < 0 || input.lengthDays < 1 || idx + input.lengthDays > input.days.length) return null;
  const window = input.days.slice(idx, idx + input.lengthDays);

  let full: Set<string> | null = null;
  const any = new Set<string>();
  for (const day of window) {
    const free = new Set<string>();
    for (const mc of input.memberCells) {
      // Trip cells are `<date>-All day`; match on the day part only.
      if (mc.cells.some((c) => splitByLastDash(c)[0] === day)) {
        free.add(mc.userId);
        any.add(mc.userId);
      }
    }
    if (full === null) full = new Set(free);
    else for (const u of [...full]) if (!free.has(u)) full.delete(u);
  }

  const count = full?.size ?? 0;
  return {
    startDate: window[0],
    endDate: window[window.length - 1],
    lengthDays: input.lengthDays,
    count,
    partialCount: any.size,
    total: input.memberCells.length,
    partial: count === 0,
  };
}

/**
 * Which result a poll board should show: the multi-day stretch, the single-cell
 * best, or nothing.
 *
 * The rule that matters: a LENGTH-AWARE trip poll must never fall back to the
 * single-cell `best`. That cell is one day, and the server keeps sending it for
 * backwards compatibility — so a naive `bestStretch ?? best` would announce a
 * single date as the winner of a multi-day trip, including when the stretch is
 * partial (nobody free for the whole run). Event polls and LEGACY trips (no
 * recorded length) keep the single-cell result, which is the right answer for
 * them.
 */
export function pollResultKind(input: {
  hasStretch: boolean;
  hasBest: boolean;
  /** The poll's trip length; null on event polls AND legacy trip polls. */
  tripLengthDays: number | null;
}): "stretch" | "cell" | "none" {
  if (input.hasStretch) return "stretch";
  if (input.tripLengthDays) return "none";
  return input.hasBest ? "cell" : "none";
}

/**
 * Should the creator be nudged that their poll has a winner? Only for a result
 * that is honestly a win: a complete stretch (not `partial`) on a length-aware
 * trip, or a single cell on any other poll — and in both cases only when 2+
 * people are actually free.
 */
export function shouldNudgePollWinner(input: {
  isCreator: boolean;
  tripLengthDays: number | null;
  stretch: { count: number; partial: boolean } | null;
  best: { count: number } | null;
}): boolean {
  if (!input.isCreator) return false;
  if (input.tripLengthDays) {
    const s = input.stretch;
    return !!s && !s.partial && s.count >= 2;
  }
  return !!input.best && input.best.count >= 2;
}

/** Is there room for a full trip starting on this day? */
export function canStartTripOn(days: string[], lengthDays: number, startDate: string): boolean {
  const idx = days.indexOf(startDate);
  return idx >= 0 && idx + lengthDays <= days.length;
}

function splitByLastDash(cell: string): [string, string] {
  const i = cell.lastIndexOf("-");
  if (i < 0) return [cell, ""];
  return [cell.slice(0, i), cell.slice(i + 1)];
}

// ---- Poll entry points ----
//
// NOTE: a `resolveResumeAction` helper used to live here and auto-resumed a
// scope that had exactly one active poll. It's gone deliberately: opening a
// board on the user's behalf is how people ended up answering a poll they
// hadn't chosen, and the "one poll" case is precisely when the auto-open looks
// harmless and is hardest to notice. Selecting a poll is always an explicit tap
// now — see ActivePollList and FindTimeChooser.

export type ActivePollSummary = { id: string };

/** How many poll cards render inline before the rest collapse behind a
 *  "See all N polls" row. Three keeps a busy squad's detail screen readable
 *  while still making a second/third active poll impossible to miss. */
export const INLINE_POLL_CAP = 3;

/**
 * Decide what an inline poll list renders: the capped visible slice plus how
 * many are hidden behind the "see all" row. The hidden count must never go
 * negative — it's rendered straight into "See all N polls".
 */
export function splitInlinePolls<T>(
  polls: T[],
  cap = INLINE_POLL_CAP,
): { visible: T[]; hiddenCount: number } {
  return { visible: polls.slice(0, cap), hiddenCount: Math.max(0, polls.length - cap) };
}

/** Live "responses received out of eligible members" label for the CTA. */
export function pollStatusLabel(o: { respondentCount: number; memberCount: number }): string {
  if (o.memberCount > 0) {
    return `${o.respondentCount} of ${o.memberCount} responded`;
  }
  return o.respondentCount === 1 ? "1 response" : `${o.respondentCount} responses`;
}
