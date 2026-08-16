/**
 * Pure date-formatting helpers for rendering an event's absolute instant on the
 * *viewer's* clock.
 *
 * These live outside TimezoneContext so they can be unit-tested without loading
 * React Native. The context owns the viewer's selected zone; everything here is
 * a pure function of (instant, zone).
 */

/** The subset of an Event needed to render a viewer-local time label. */
export type TimeDisplayEvent = {
  date: string;
  eventAt?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  allDay?: boolean;
};

/** The device/browser's current IANA zone, or "UTC" if the runtime won't say. */
export function runtimeTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Daylight-aware short zone name ("PDT" in summer, "PST" in winter) for the
 * given instant. Computed via Intl rather than a hardcoded zone→abbreviation
 * table, which would go stale twice a year. Falls back to the zone id so a
 * label is never blank.
 */
export function zoneAbbreviation(date: Date, timezone: string): string {
  try {
    return (
      new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "short" })
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")?.value ?? timezone
    );
  } catch {
    return timezone;
  }
}

/** "Los Angeles (PDT)" — a human-readable label for an IANA zone id. */
export function zoneLabel(timezone: string, at: Date = new Date()): string {
  const city = timezone.split("/").pop()?.replace(/_/g, " ") ?? timezone;
  const abbr = zoneAbbreviation(at, timezone);
  return abbr === timezone ? city : `${city} (${abbr})`;
}

export function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Sat, Jun 7 · 8:00 PM PDT" for an absolute instant in a given zone. */
export function formatInstantIn(date: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const day = `${get("weekday")}, ${get("month")} ${get("day")}`;
    const time = `${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
    return `${day} · ${time} ${zoneAbbreviation(date, timezone)}`;
  } catch {
    return "";
  }
}

/**
 * An event's start rendered in `timezone`, falling back to the event's stored
 * display text. All-day and TBD events have no meaningful clock time to
 * convert, and legacy events predate the absolute timestamp — their stored text
 * is the only accurate thing we have, so it is kept verbatim.
 */
export function formatEventTimeIn(event: TimeDisplayEvent, timezone: string): string {
  const date = parseIso(event.startAt ?? event.eventAt);
  if (!date || event.allDay) return event.date;
  return formatInstantIn(date, timezone) || event.date;
}

/**
 * A trip's date range for display.
 *
 * All-day trips (the default) have no real clock time: their stored instants
 * are synthetic creator-local anchors (9 AM / 6 PM). Converting those to a
 * distant viewer's zone shifts them across midnight and shows the wrong
 * calendar dates — a Jul 18–22 trip reading as Jul 19–23 in Tokyo. So an
 * all-day range keeps the creator's stored text, which is the authored range.
 * Only a timed trip is converted to the viewer's clock.
 */
export function formatTripRangeIn(trip: TimeDisplayEvent, timezone: string): string {
  if (trip.allDay) {
    // Best effort only if the stored text is missing (shouldn't happen: trips
    // are created with a range label).
    return trip.date || formatRangeIn(trip.startAt, trip.endAt, timezone);
  }
  if (trip.startAt) return formatRangeIn(trip.startAt, trip.endAt, timezone);
  return trip.date;
}

/** "Jul 18 – 22, 2026" / "Jul 28 – Aug 2, 2026" in the given zone. */
export function formatRangeIn(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  timezone: string,
): string {
  const start = parseIso(startIso);
  if (!start) return "Dates TBD";
  const end = parseIso(endIso);
  try {
    const dayKey = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
    const pieces = (d: Date) => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "short",
        day: "numeric",
      }).formatToParts(d);
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      return { month: get("month"), day: get("day"), year: get("year") };
    };
    const s = pieces(start);
    if (!end || dayKey(end) === dayKey(start)) return `${s.month} ${s.day}, ${s.year}`;
    const e = pieces(end);
    if (s.month === e.month && s.year === e.year) return `${s.month} ${s.day} – ${e.day}, ${s.year}`;
    return `${s.month} ${s.day} – ${e.month} ${e.day}, ${e.year}`;
  } catch {
    return "Dates TBD";
  }
}
