import type { Event, ItineraryStop } from "@/types";
import { parseEventStart } from "@/lib/calendar";

/**
 * Pure ICS (RFC 5545) generation for a single plan — an event or a trip.
 *
 * - Events: one VEVENT anchored at the machine-readable `eventAt` timestamp
 *   (2h default duration). When only the freeform display date is available,
 *   fall back to it: a timed VEVENT if the text carries an explicit time,
 *   otherwise an all-day VEVENT on that day.
 * - Trips: one all-day VEVENT spanning the trip's start–end dates, plus one
 *   timed VEVENT per itinerary stop that has a parseable time — all inside the
 *   same VCALENDAR. Stop times are written as floating local times (no zone),
 *   which is what you want for travel.
 *
 * Kept intentionally minimal: no recurrence, no alarms, no geocoding —
 * locations are passed through verbatim as freeform text.
 */

const EVENT_DURATION_MS = 2 * 60 * 60 * 1000;
const STOP_DEFAULT_DURATION_MS = 60 * 60 * 1000;

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 content lines should stay within 75 octets; fold with CRLF + space. */
function foldLine(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [line.slice(0, 74)];
  let rest = line.slice(74);
  while (rest.length > 73) {
    parts.push(" " + rest.slice(0, 73));
    rest = rest.slice(73);
  }
  if (rest) parts.push(" " + rest);
  return parts.join("\r\n");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC timestamp form: 20260705T183000Z */
function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Local (floating) timestamp form: 20260705T090000 — no zone designator. */
function floatingStamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

/** All-day date form (local calendar day of the given Date): 20260705 */
function dateStamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function addDaysToDateStamp(stamp: string, days: number): string {
  const d = new Date(
    parseInt(stamp.slice(0, 4), 10),
    parseInt(stamp.slice(4, 6), 10) - 1,
    parseInt(stamp.slice(6, 8), 10) + days,
  );
  return dateStamp(d);
}

/** Parse a freeform display time like "9:00 AM", "14:30" → hours/minutes, or null. */
export function parseTimeLabel(label: string): { hours: number; minutes: number } | null {
  const m = label.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  if (m[3]) {
    if (hours < 1 || hours > 12) return null;
    hours = hours % 12;
    if (/pm/i.test(m[3])) hours += 12;
  }
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

/** "2026-07-18" + {hours,minutes} → local Date, or null if the day is malformed. */
function stopDateTime(day: string, time: { hours: number; minutes: number }): Date | null {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(
    parseInt(m[1], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[3], 10),
    time.hours,
    time.minutes,
    0,
    0,
  );
}

type VEventInput = {
  uid: string;
  summary: string;
  location?: string;
  description?: string;
  /** Exactly one of the three start shapes below. */
  start:
    | { kind: "utc"; start: Date; end: Date }
    | { kind: "floating"; start: Date; end: Date }
    | { kind: "allDay"; startDay: Date; endDayInclusive: Date };
};

function buildVEvent(input: VEventInput, dtStamp: string): string[] {
  const lines: string[] = ["BEGIN:VEVENT", `UID:${input.uid}`, `DTSTAMP:${dtStamp}`];
  const s = input.start;
  if (s.kind === "utc") {
    lines.push(`DTSTART:${utcStamp(s.start)}`);
    lines.push(`DTEND:${utcStamp(s.end)}`);
  } else if (s.kind === "floating") {
    lines.push(`DTSTART:${floatingStamp(s.start)}`);
    lines.push(`DTEND:${floatingStamp(s.end)}`);
  } else {
    const startStamp = dateStamp(s.startDay);
    // DTEND for all-day events is exclusive — the day after the last day.
    const endStamp = addDaysToDateStamp(dateStamp(s.endDayInclusive), 1);
    lines.push(`DTSTART;VALUE=DATE:${startStamp}`);
    lines.push(`DTEND;VALUE=DATE:${endStamp}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(input.summary)}`);
  if (input.location && input.location.trim() && input.location.trim() !== "TBD") {
    lines.push(`LOCATION:${escapeIcsText(input.location.trim())}`);
  }
  if (input.description && input.description.trim()) {
    lines.push(`DESCRIPTION:${escapeIcsText(input.description.trim())}`);
  }
  lines.push("END:VEVENT");
  return lines;
}

function wrapCalendar(vevents: string[][]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Squadz//Add to Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const ev of vevents) lines.push(...ev);
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function safeFilename(title: string): string {
  const base = title
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return `${base || "squadz-plan"}.ics`;
}

export type PlanIcs = { filename: string; content: string };

type PlanLike = Pick<
  Event,
  "id" | "emoji" | "title" | "date" | "type" | "eventAt" | "startAt" | "endAt" | "location" | "description"
> & { itinerary?: ItineraryStop[] };

/**
 * Build a shareable .ics for one plan. Returns null when the plan has no
 * usable date information at all.
 */
export function buildPlanIcs(plan: PlanLike, now: Date = new Date()): PlanIcs | null {
  const dtStamp = utcStamp(now);
  const summary = `${plan.emoji ?? ""} ${plan.title}`.trim();
  const filename = safeFilename(plan.title);

  if (plan.type === "trip") {
    const startIso = plan.startAt ?? plan.eventAt;
    if (!startIso) return null;
    const start = new Date(startIso);
    if (isNaN(start.getTime())) return null;
    const endRaw = plan.endAt ? new Date(plan.endAt) : start;
    const end = isNaN(endRaw.getTime()) || endRaw.getTime() < start.getTime() ? start : endRaw;

    const vevents: string[][] = [
      buildVEvent(
        {
          uid: `${plan.id}@squadz`,
          summary,
          location: plan.location,
          description: plan.description,
          start: { kind: "allDay", startDay: start, endDayInclusive: end },
        },
        dtStamp,
      ),
    ];

    // Timed itinerary stops become sub-events inside the same file.
    for (const stop of plan.itinerary ?? []) {
      const time = parseTimeLabel(stop.time ?? "");
      if (!time) continue;
      const stopStart = stopDateTime(stop.day, time);
      if (!stopStart) continue;
      const endTime = parseTimeLabel(stop.endTime ?? "");
      const stopEndCandidate = endTime ? stopDateTime(stop.day, endTime) : null;
      const stopEnd =
        stopEndCandidate && stopEndCandidate.getTime() > stopStart.getTime()
          ? stopEndCandidate
          : new Date(stopStart.getTime() + STOP_DEFAULT_DURATION_MS);
      vevents.push(
        buildVEvent(
          {
            uid: `${plan.id}-${stop.id}@squadz`,
            summary: stop.title || stop.placeName || "Itinerary stop",
            location: stop.address || stop.placeName || undefined,
            description: stop.note || undefined,
            start: { kind: "floating", start: stopStart, end: stopEnd },
          },
          dtStamp,
        ),
      );
    }

    return { filename, content: wrapCalendar(vevents) };
  }

  // Plain event.
  if (plan.eventAt) {
    const start = new Date(plan.eventAt);
    if (!isNaN(start.getTime())) {
      const end = new Date(start.getTime() + EVENT_DURATION_MS);
      return {
        filename,
        content: wrapCalendar([
          buildVEvent(
            {
              uid: `${plan.id}@squadz`,
              summary,
              location: plan.location,
              description: plan.description,
              start: { kind: "utc", start, end },
            },
            dtStamp,
          ),
        ]),
      };
    }
  }

  // Fall back to the freeform display date.
  const parsed = parseEventStart(plan.date ?? "");
  if (!parsed) return null;
  const hasExplicitTime = /\d{1,2}:\d{2}\s*(AM|PM)/i.test(plan.date ?? "");
  const start = hasExplicitTime
    ? ({ kind: "floating", start: parsed, end: new Date(parsed.getTime() + EVENT_DURATION_MS) } as const)
    : ({ kind: "allDay", startDay: parsed, endDayInclusive: parsed } as const);
  return {
    filename,
    content: wrapCalendar([
      buildVEvent(
        {
          uid: `${plan.id}@squadz`,
          summary,
          location: plan.location,
          description: plan.description,
          start,
        },
        dtStamp,
      ),
    ]),
  };
}
