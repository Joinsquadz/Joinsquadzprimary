/**
 * Age gate (13+) — COPPA compliance.
 *
 * The client collects a birth year, but the client gate is only UX:
 * `/api/auth/register` runs these helpers itself so a direct API call cannot
 * bypass the minimum age.
 *
 * Data minimization: callers persist only what `deriveAgeFields` returns (a
 * pass/fail marker plus the birth year).
 */

/** Minimum age required to hold a SquadZ account. */
export const MIN_SIGNUP_AGE = 13;

/** Oldest plausible birth year — guards against typos and junk payloads. */
const MIN_BIRTH_YEAR = 1900;

export interface AgeFields {
  meetsMinAge: boolean;
  birthYear: number;
}

export type AgeCheckResult =
  | { ok: true; fields: AgeFields }
  | { ok: false; reason: "invalid" | "under_age" };

/**
 * Validates a submitted birth year against the 13+ minimum and reduces it
 * to the two fields we are willing to store.
 *
 * A future or unparseable year is "invalid" (400); a year later than the
 * newest eligible year is "under_age" (403). With no birthday data, a birth
 * year equal to `currentYear - 13` is considered eligible.
 */
export function deriveAgeFields(rawBirthYear: string, now: Date = new Date()): AgeCheckResult {
  if (!/^\d{4}$/.test(rawBirthYear.trim())) return { ok: false, reason: "invalid" };
  const birthYear = Number(rawBirthYear);
  const currentYear = now.getUTCFullYear();
  if (birthYear < MIN_BIRTH_YEAR || birthYear > currentYear) return { ok: false, reason: "invalid" };
  if (birthYear > currentYear - MIN_SIGNUP_AGE) return { ok: false, reason: "under_age" };
  return { ok: true, fields: { meetsMinAge: true, birthYear } };
}
