import type { Event, RsvpStatus } from "@/types";

export function goingIds(event: Event): string[] {
  return Object.entries(event.rsvps)
    .filter(([, status]) => status === "going")
    .map(([id]) => id);
}

export function goingCount(event: Event): number {
  return goingIds(event).length;
}

/**
 * The set of people attending, correct for BOTH events and trips.
 *
 * Events use the RSVP map (status === "going"). Trips have no RSVP UI — everyone
 * on the roster (the trip's squad members + directly-invited friends + the host)
 * is attending. Counting a trip's rsvps would show only the host, since the host
 * is the sole "going" seeded at trip creation, hence the "1 going" undercount.
 */
export function attendingIds(event: Event, squadMemberIds: readonly string[] = []): string[] {
  if (event.type === "trip") {
    const ids = new Set<string>([...squadMemberIds, ...(event.invitedUserIds ?? [])]);
    if (event.hostId) ids.add(event.hostId);
    return [...ids];
  }
  return goingIds(event);
}

export function attendingCount(event: Event, squadMemberIds: readonly string[] = []): number {
  return attendingIds(event, squadMemberIds).length;
}

/**
 * Deterministic key for every user id an open plan screen has to display.
 *
 * The detail screen prefetches display names/photos for these ids. Keying that
 * prefetch on `event.id` alone means a guest who RSVPs (or is invited) while the
 * screen is open never gets fetched, so they render as a "..." placeholder — or,
 * for the host watching the guest list fill in, appear only after a remount.
 * Sorted so an unchanged roster in a different server order is not a change.
 */
export function eventRosterKey(event: Pick<Event, "hostId" | "rsvps" | "invitedUserIds" | "tasks" | "costs">): string {
  return [
    event.hostId,
    ...Object.keys(event.rsvps ?? {}),
    ...(event.invitedUserIds ?? []),
    ...(event.tasks ?? []).map((t) => t.assigneeId).filter((v): v is string => !!v),
    ...(event.costs ?? []).map((c) => c.paidById),
  ]
    .filter(Boolean)
    .sort()
    .join(",");
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
