import type { Event, ItineraryStop, StopCategory } from "@/types";

/** Cover gradient presets for trip cards/headers, keyed by `coverStyle`. */
export const TRIP_COVERS: Record<string, readonly [string, string]> = {
  sunset: ["#FF6B2C", "#FF8050"],
  ocean: ["#4A9EFF", "#2ECC8A"],
  forest: ["#2ECC8A", "#4A9EFF"],
  berry: ["#A855F7", "#FF6B2C"],
  gold: ["#FFB23E", "#FF8050"],
  night: ["#1A1A26", "#A855F7"],
};

export const TRIP_COVER_KEYS = Object.keys(TRIP_COVERS);

export function coverFor(coverStyle?: string | null): readonly [string, string] {
  return (coverStyle && TRIP_COVERS[coverStyle]) || TRIP_COVERS.sunset;
}

export const STOP_CATEGORY_META: Record<
  StopCategory,
  { label: string; icon: string; colorKey: "primary" | "blue" | "green" | "gold" | "purple" }
> = {
  food: { label: "Food", icon: "restaurant-outline", colorKey: "gold" },
  activity: { label: "Activity", icon: "sparkles-outline", colorKey: "primary" },
  lodging: { label: "Stay", icon: "bed-outline", colorKey: "purple" },
  travel: { label: "Travel", icon: "airplane-outline", colorKey: "blue" },
  other: { label: "Other", icon: "ellipsis-horizontal-circle-outline", colorKey: "green" },
};

export const STOP_CATEGORIES: StopCategory[] = ["activity", "food", "lodging", "travel", "other"];

/** Parses an ISO instant; returns null if absent/invalid. */
export function parseISO(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** "2026-07-18" calendar-date key (local) for an ISO instant. */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's calendar-date key (local). */
export function todayKey(): string {
  return dayKey(new Date());
}

/** Ordered list of calendar-date keys spanning a trip's start→end (inclusive). */
export function tripDayKeys(trip: Pick<Event, "startAt" | "endAt">): string[] {
  const start = parseISO(trip.startAt);
  const end = parseISO(trip.endAt) ?? start;
  if (!start) return [];
  const days: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate()) : cur;
  // Guard against pathological ranges.
  for (let i = 0; i < 366 && cur <= last; i++) {
    days.push(dayKey(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Jul 18 – 22" / "Jul 28 – Aug 2, 2026" style range label for a trip. */
export function formatTripRange(trip: Pick<Event, "startAt" | "endAt">): string {
  const start = parseISO(trip.startAt);
  if (!start) return "Dates TBD";
  const end = parseISO(trip.endAt);
  const sM = MONTHS[start.getMonth()];
  const sD = start.getDate();
  const yr = start.getFullYear();
  if (!end || dayKey(end) === dayKey(start)) {
    return `${sM} ${sD}, ${yr}`;
  }
  const eM = MONTHS[end.getMonth()];
  const eD = end.getDate();
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${sM} ${sD} – ${eD}, ${yr}`;
  }
  return `${sM} ${sD} – ${eM} ${eD}, ${end.getFullYear()}`;
}

/** Number of nights in a trip (0 for single-day or undated). */
export function tripNights(trip: Pick<Event, "startAt" | "endAt">): number {
  const keys = tripDayKeys(trip);
  return keys.length > 1 ? keys.length - 1 : 0;
}

/** A short "Day 2 · Sat, Jul 19" heading for an itinerary day section. */
export function formatDayHeading(key: string, index: number): { label: string; sub: string } {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return {
    label: `Day ${index + 1}`,
    sub: `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`,
  };
}

/** True while now is within [startAt, endAt] (inclusive of the end day). */
export function isHappeningNow(trip: Pick<Event, "startAt" | "endAt">): boolean {
  const start = parseISO(trip.startAt);
  if (!start) return false;
  const end = parseISO(trip.endAt) ?? start;
  const now = new Date();
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
  return now >= startDay && now <= endDay;
}

/** True once the trip's end day is in the past. */
export function isTripPast(trip: Pick<Event, "startAt" | "endAt">): boolean {
  const end = parseISO(trip.endAt) ?? parseISO(trip.startAt);
  if (!end) return false;
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);
  return new Date() > endDay;
}

/** Groups stops by day key, each day's stops ordered by sortOrder then time. */
export function groupStopsByDay(stops: ItineraryStop[]): Record<string, ItineraryStop[]> {
  const groups: Record<string, ItineraryStop[]> = {};
  for (const s of stops) {
    (groups[s.day] ??= []).push(s);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => a.sortOrder - b.sortOrder || a.time.localeCompare(b.time));
  }
  return groups;
}

/** Sum of confirmed + proposed stop costs (proposed kept separate by caller). */
export function sumStopCosts(stops: ItineraryStop[]): { confirmed: number; proposed: number } {
  let confirmed = 0;
  let proposed = 0;
  for (const s of stops) {
    if (typeof s.cost === "number" && s.cost > 0) {
      if (s.status === "confirmed") confirmed += s.cost;
      else proposed += s.cost;
    }
  }
  return { confirmed, proposed };
}
