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

/**
 * Convert a Date to a "calendar day ID" — the UTC timestamp of midnight UTC
 * for the given date expressed in the specified IANA timezone. Used to compare
 * two dates by calendar day (ignoring time-of-day).
 */
function toCalendarDayId(d: Date, tz: string): number {
  try {
    // en-CA formats dates as "YYYY-MM-DD" which is unambiguous to parse.
    const s = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    const [y, mo, day] = s.split("-").map(Number);
    return Date.UTC(y!, mo! - 1, day!);
  } catch {
    // Invalid or unsupported timezone — fall back to UTC wall-clock date.
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
}

/**
 * Number of calendar days from `now` to `start` in the given IANA timezone.
 * Positive = start is in the future, 0 = same calendar day, negative = past.
 * Falls back to UTC when `tz` is null, undefined, or an invalid string.
 *
 * Example: if now is Friday 11 PM EDT and start is Saturday 8 AM EDT, this
 * returns 1 ("tomorrow") — correctly capturing the day boundary.
 */
export function calendarDaysUntil(now: Date, start: Date, tz: string | null | undefined): number {
  const zone = tz ?? "UTC";
  const nowDay = toCalendarDayId(now, zone);
  const startDay = toCalendarDayId(start, zone);
  return Math.round((startDay - nowDay) / (24 * 60 * 60 * 1000));
}
