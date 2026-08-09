/**
 * Client-side age-gate helpers.
 *
 * The server is the enforcement point (POST /api/auth/register rejects
 * under-13 signups with 403 UNDER_MIN_AGE); this module exists so the UI can
 * fail fast with a clear message instead of a round-trip. Keep MIN_SIGNUP_AGE
 * in sync with the server's lib/age.ts.
 *
 * Only the derived facts leave the device — the app sends the date of birth
 * once at registration and the server stores a boolean plus the birth year,
 * never the exact date.
 */
export const MIN_SIGNUP_AGE = 13;

/** Format a Date as the `YYYY-MM-DD` string the register endpoint expects. */
export function toDobString(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** True when `value` is a real calendar date in `YYYY-MM-DD` form. */
export function isValidDobString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  );
}

/**
 * Completed years between `dob` (YYYY-MM-DD) and `on` (defaults to today).
 * Returns null for an unparseable or future date so callers can distinguish
 * "invalid" from "too young".
 */
export function ageOn(dob: string, on: Date = new Date()): number | null {
  if (!isValidDobString(dob)) return null;
  const [y, m, d] = dob.split("-").map(Number);
  const birth = new Date(Date.UTC(y, m - 1, d));
  const today = new Date(Date.UTC(on.getFullYear(), on.getMonth(), on.getDate()));
  if (birth.getTime() > today.getTime()) return null;

  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < birth.getUTCMonth() ||
    (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** True when the date of birth clears the minimum signup age. */
export function meetsMinAge(dob: string, on: Date = new Date()): boolean {
  const age = ageOn(dob, on);
  return age !== null && age >= MIN_SIGNUP_AGE;
}
