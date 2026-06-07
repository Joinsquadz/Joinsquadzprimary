import type { Event, RsvpStatus } from "@/types";

export function goingIds(event: Event): string[] {
  return Object.entries(event.rsvps)
    .filter(([, status]) => status === "going")
    .map(([id]) => id);
}

export function goingCount(event: Event): number {
  return goingIds(event).length;
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export function parseEventDate(date: string, year = 2026): Date | null {
  const m = date.match(/([A-Z][a-z]{2})\s+(\d{1,2})/);
  if (!m || !(m[1] in MONTHS)) return null;
  return new Date(year, MONTHS[m[1]], parseInt(m[2], 10));
}

export { type RsvpStatus };
