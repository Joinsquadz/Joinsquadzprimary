const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Best-effort parse of an event's free-form `date` text into an absolute start
 * Date. Returns null when the text can't be confidently interpreted (e.g.
 * "TBD", empty, or a format we don't recognise) so callers can safely skip it.
 *
 * The mobile app formats picked dates as `"Sat, Jun 7 · 5:00 PM"` — note there
 * is no year, so we assume the current year and roll forward to next year if
 * that would place the event more than ~2 days in the past. As a fallback we
 * also try the native Date parser for ISO-ish strings.
 */
export function parseEventStart(dateText: string | null | undefined, now: Date = new Date()): Date | null {
  if (!dateText) return null;
  const t = dateText.trim();
  if (!t || t.toUpperCase() === "TBD") return null;

  // App format: "<Weekday>, <Mon> <Day> · <h>:<mm> <AM/PM>" (year-less).
  const m = t.match(/([A-Za-z]{3,})\s+(\d{1,2}).*?(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (m) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      const day = parseInt(m[2], 10);
      const minute = parseInt(m[4], 10);
      let hour = parseInt(m[3], 10) % 12;
      if (m[5].toUpperCase() === "PM") hour += 12;
      let candidate = new Date(now.getFullYear(), month, day, hour, minute, 0, 0);
      if (candidate.getTime() < now.getTime() - TWO_DAYS_MS) {
        candidate = new Date(now.getFullYear() + 1, month, day, hour, minute, 0, 0);
      }
      return Number.isNaN(candidate.getTime()) ? null : candidate;
    }
  }

  // Fallback: native parser for ISO / RFC-ish strings.
  const native = new Date(t);
  return Number.isNaN(native.getTime()) ? null : native;
}
