/**
 * Age gate (13+) — COPPA compliance.
 *
 * The client shows a date-of-birth picker, but the client gate is only UX:
 * `/api/auth/register` runs these helpers itself so a direct API call cannot
 * bypass the minimum age.
 *
 * Data minimization: callers persist only what `deriveAgeFields` returns (a
 * pass/fail marker plus the birth year). The exact day/month is used for the
 * age computation and then discarded.
 */

/** Minimum age required to hold a SquadZ account. */
export const MIN_SIGNUP_AGE = 13;

/** Oldest plausible birth year — guards against typos and junk payloads. */
const MIN_BIRTH_YEAR = 1900;

export interface AgeFields {
  meetsMinAge: boolean;
  birthYear: number;
}

/**
 * Parses a `YYYY-MM-DD` date of birth into its calendar parts.
 * Returns null when the string is malformed or not a real calendar date
 * (e.g. 2011-02-30), so callers can reject the payload.
 */
export function parseDateOfBirth(raw: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < MIN_BIRTH_YEAR) return null;
  // Reject dates that roll over (Feb 30 → Mar 2) so only real dates pass.
  const asDate = new Date(Date.UTC(year, month - 1, day));
  if (
    asDate.getUTCFullYear() !== year ||
    asDate.getUTCMonth() !== month - 1 ||
    asDate.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * Whole years elapsed between the date of birth and `now`. The birthday must
 * have already occurred this year to count, so someone turning 13 tomorrow is
 * still 12 today.
 */
export function calculateAge(
  dob: { year: number; month: number; day: number },
  now: Date = new Date(),
): number {
  const nowYear = now.getUTCFullYear();
  const nowMonth = now.getUTCMonth() + 1;
  const nowDay = now.getUTCDate();
  let age = nowYear - dob.year;
  if (nowMonth < dob.month || (nowMonth === dob.month && nowDay < dob.day)) {
    age -= 1;
  }
  return age;
}

export type AgeCheckResult =
  | { ok: true; fields: AgeFields }
  | { ok: false; reason: "invalid" | "under_age" };

/**
 * Validates a submitted date of birth against the 13+ minimum and reduces it
 * to the two fields we are willing to store.
 *
 * A future-dated or unparseable DOB is "invalid" (400); a real date under the
 * minimum is "under_age" (403) so the client can show the right message.
 */
export function deriveAgeFields(rawDob: string, now: Date = new Date()): AgeCheckResult {
  const dob = parseDateOfBirth(rawDob);
  if (!dob) return { ok: false, reason: "invalid" };
  const age = calculateAge(dob, now);
  if (age < 0) return { ok: false, reason: "invalid" };
  if (age < MIN_SIGNUP_AGE) return { ok: false, reason: "under_age" };
  return { ok: true, fields: { meetsMinAge: true, birthYear: dob.year } };
}
