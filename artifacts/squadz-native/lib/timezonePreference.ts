/**
 * Pure decision logic for resolving a viewer's timezone preference.
 *
 * Kept out of TimezoneContext so the rules can be unit-tested without React or
 * the native runtime. The context owns the I/O (cache read, preferences fetch);
 * these functions own *what the answer should be*.
 */

export type TimezoneMode = "automatic" | "manual";

export type CachedTimezone = { timezone?: string; mode?: TimezoneMode } | null;

export type RemotePreferences = { timezone?: string | null; timezoneMode?: TimezoneMode };

export type TimezoneState = { timezone: string; mode: TimezoneMode };

/**
 * The state to apply after a successful preferences read.
 *
 * Automatic mode tracks the device, so it always adopts the detected zone.
 * Manual mode uses the saved zone, only falling back to detection if the saved
 * value is somehow missing.
 */
export function resolveSyncedTimezone(prefs: RemotePreferences, detected: string): TimezoneState {
  const mode: TimezoneMode = prefs.timezoneMode === "manual" ? "manual" : "automatic";
  const timezone = mode === "automatic" ? detected : (prefs.timezone || detected);
  return { timezone, mode };
}

/** Whether a successful automatic-mode sync should write the detected zone back. */
export function shouldPersistDetected(prefs: RemotePreferences, detected: string): boolean {
  const { mode } = resolveSyncedTimezone(prefs, detected);
  return mode === "automatic" && prefs.timezone !== detected;
}

/**
 * The zone to display when the preferences read FAILS (offline, server down).
 *
 * A manual selection is never overwritten: returning the detected device zone
 * here would silently revert a deliberate choice on every offline launch or
 * resume, and shift every event time the user reads. With no manual choice on
 * record, tracking the device is the correct automatic behavior.
 */
export function resolveOfflineTimezone(cached: CachedTimezone, detected: string): TimezoneState {
  if (cached?.mode === "manual" && cached.timezone) {
    return { timezone: cached.timezone, mode: "manual" };
  }
  return { timezone: detected, mode: cached?.mode ?? "automatic" };
}
