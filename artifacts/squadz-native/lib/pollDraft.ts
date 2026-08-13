import AsyncStorage from "@react-native-async-storage/async-storage";

// Dedicated draft persistence for the "Find the Best Time" creation wizard.
//
// There is no generic draft utility in the app, so this follows the same narrow
// pattern as lib/pendingInvite.ts: one dedicated key namespace, a savedAt
// stamp, a hard expiry, and best-effort writes that never throw into the UI.
//
// Scope note: the draft is keyed per creation scope (squad / event / ad-hoc) so
// starting a poll for one squad can't resurrect a half-finished draft from a
// different squad.
//
// This intentionally does NOT persist the response grid's unsaved cells — those
// are already covered by the in-session dirty state and the beforeRemove guard.

const DRAFT_KEY_PREFIX = "@squadz/pollDraft/";
const EXPIRY_MS = 24 * 60 * 60 * 1000;

export type PollDraft = {
  /** Optional poll title (step 1). */
  title: string;
  /** Range start as an ISO calendar date, e.g. "2026-08-12" (step 2). */
  rangeStartISO: string;
  /** Number of consecutive days in the range (step 2). */
  rangeDays: number;
  /** Selected time slots, e.g. ["6PM","7PM"] (step 3). */
  slots: string[];
  /** Which period tab was open, so the wizard reopens where they left off. */
  period: string;
  /** Wizard step index the user was on. */
  step: number;
  /**
   * Trip polls only: how many days the trip runs (step 3 for trips).
   *
   * Optional on purpose — drafts written before trip length existed must still
   * restore rather than being thrown away as malformed, and event drafts never
   * carry one.
   */
  tripLengthDays?: number;
};

type StoredDraft = PollDraft & { savedAt: number };

export function pollDraftKey(scope: {
  squadId?: string | null;
  eventId?: string | null;
  adhoc?: boolean;
}): string {
  if (scope.squadId) return `squad:${scope.squadId}`;
  if (scope.eventId) return `event:${scope.eventId}`;
  if (scope.adhoc) return "adhoc";
  return "unscoped";
}

function storageKey(scopeKey: string): string {
  return `${DRAFT_KEY_PREFIX}${scopeKey}`;
}

function isValidDraft(v: Partial<StoredDraft> | null | undefined): v is StoredDraft {
  if (!v || typeof v !== "object") return false;
  return (
    typeof v.title === "string" &&
    typeof v.rangeStartISO === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v.rangeStartISO) &&
    typeof v.rangeDays === "number" &&
    Number.isFinite(v.rangeDays) &&
    v.rangeDays > 0 &&
    Array.isArray(v.slots) &&
    v.slots.every((s) => typeof s === "string") &&
    typeof v.period === "string" &&
    typeof v.step === "number" &&
    Number.isFinite(v.step) &&
    v.step >= 0 &&
    // Absent is valid (older drafts / event polls); present must be sane.
    (v.tripLengthDays === undefined ||
      (typeof v.tripLengthDays === "number" &&
        Number.isInteger(v.tripLengthDays) &&
        v.tripLengthDays > 0)) &&
    typeof v.savedAt === "number"
  );
}

export async function savePollDraft(scopeKey: string, draft: PollDraft): Promise<void> {
  try {
    const payload: StoredDraft = { ...draft, savedAt: Date.now() };
    await AsyncStorage.setItem(storageKey(scopeKey), JSON.stringify(payload));
  } catch {
    // Best-effort — losing a draft must never break poll creation.
  }
}

/** Returns the stored draft if present, well-formed and under 24h old. Expired or malformed entries are cleared. */
export async function readPollDraft(scopeKey: string): Promise<PollDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(scopeKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (!isValidDraft(parsed) || Date.now() - parsed.savedAt > EXPIRY_MS) {
      await AsyncStorage.removeItem(storageKey(scopeKey));
      return null;
    }
    const { savedAt: _savedAt, ...draft } = parsed;
    return draft;
  } catch {
    return null;
  }
}

export async function clearPollDraft(scopeKey: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(scopeKey));
  } catch {
    // Ignore.
  }
}

/** True when a restored draft actually differs from a fresh form (worth telling the user about). */
export function draftHasContent(
  draft: PollDraft,
  defaults: { rangeDays: number; slots: string[]; tripLengthDays?: number },
): boolean {
  if (draft.title.trim().length > 0) return true;
  if (draft.rangeDays !== defaults.rangeDays) return true;
  if (draft.step > 0) return true;
  if (
    draft.tripLengthDays !== undefined &&
    defaults.tripLengthDays !== undefined &&
    draft.tripLengthDays !== defaults.tripLengthDays
  ) {
    return true;
  }
  const a = [...draft.slots].sort();
  const b = [...defaults.slots].sort();
  return a.length !== b.length || a.some((s, i) => s !== b[i]);
}
