/**
 * Client-side age-gate helpers.
 *
 * The server is the enforcement point (POST /api/auth/register rejects
 * under-13 signups with 403 UNDER_MIN_AGE); this module exists so the UI can
 * fail fast with a clear message instead of a round-trip. Keep MIN_SIGNUP_AGE
 * in sync with the server's lib/age.ts.
 *
 * The app sends only a birth year at registration. The server stores a boolean
 * plus that birth year, never an exact date of birth.
 */
export const MIN_SIGNUP_AGE = 13;

/** True when `value` is a four-digit, plausible birth year. */
export function isValidBirthYear(value: string, on: Date = new Date()): boolean {
  if (!/^\d{4}$/.test(value.trim())) return false;
  const year = Number(value);
  return year >= 1900 && year <= on.getFullYear();
}

/** True when a birth year clears the minimum signup age. */
export function meetsMinAge(birthYear: string, on: Date = new Date()): boolean {
  return isValidBirthYear(birthYear, on) && Number(birthYear) <= on.getFullYear() - MIN_SIGNUP_AGE;
}
