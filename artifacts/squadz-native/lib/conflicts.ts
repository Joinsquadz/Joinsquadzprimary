import type { Event, Squad } from "@/types";
import { parseEventStart } from "@/lib/calendar";
import { attendingIds } from "@/lib/eventUtils";

/**
 * Private, per-user cross-squad conflict detection.
 *
 * Everything here runs on the client against the current user's OWN plans
 * list, so conflict info is visible only to the affected user — one squad's
 * activity never leaks into another.
 *
 * Overlap rules:
 * - Trip vs Trip        → date ranges intersect              → hard
 * - Trip vs Event       → event's day falls inside the range → hard
 * - Event vs Event, same day:
 *     - both have concrete times and the ranges overlap      → hard
 *     - either lacks a time                                  → soft (same-day heads-up)
 */

export type ConflictLevel = "hard" | "soft";
export type PlanConflict = { plan: Event; level: ConflictLevel };

const EVENT_DURATION_MS = 2 * 60 * 60 * 1000;

export type PlanSpan =
  | { kind: "range"; startDay: string; endDay: string }
  | { kind: "timed"; day: string; startMs: number; endMs: number }
  | { kind: "day"; day: string };

function dayKeyOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type SpanSource = Pick<Event, "type" | "date"> &
  Partial<Pick<Event, "eventAt" | "startAt" | "endAt">>;

/** Derive when a plan occupies the user's calendar. Null = no usable date. */
export function getPlanSpan(plan: SpanSource): PlanSpan | null {
  if (plan.type === "trip") {
    const startIso = plan.startAt ?? plan.eventAt;
    if (!startIso) return null;
    const start = new Date(startIso);
    if (isNaN(start.getTime())) return null;
    const endRaw = plan.endAt ? new Date(plan.endAt) : start;
    const end = isNaN(endRaw.getTime()) || endRaw.getTime() < start.getTime() ? start : endRaw;
    return { kind: "range", startDay: dayKeyOf(start), endDay: dayKeyOf(end) };
  }

  if (plan.eventAt) {
    const start = new Date(plan.eventAt);
    if (!isNaN(start.getTime())) {
      return {
        kind: "timed",
        day: dayKeyOf(start),
        startMs: start.getTime(),
        endMs: start.getTime() + EVENT_DURATION_MS,
      };
    }
  }

  const parsed = parseEventStart(plan.date ?? "");
  if (!parsed) return null;
  const hasExplicitTime = /\d{1,2}:\d{2}\s*(AM|PM)/i.test(plan.date ?? "");
  if (hasExplicitTime) {
    return {
      kind: "timed",
      day: dayKeyOf(parsed),
      startMs: parsed.getTime(),
      endMs: parsed.getTime() + EVENT_DURATION_MS,
    };
  }
  return { kind: "day", day: dayKeyOf(parsed) };
}

function daySpanOf(s: PlanSpan): { start: string; end: string } {
  return s.kind === "range" ? { start: s.startDay, end: s.endDay } : { start: s.day, end: s.day };
}

/** Classify the overlap between two spans, or null when they don't overlap. */
export function spansOverlap(a: PlanSpan, b: PlanSpan): ConflictLevel | null {
  const da = daySpanOf(a);
  const db = daySpanOf(b);
  // ISO "YYYY-MM-DD" compares correctly as a string.
  const daysIntersect = da.start <= db.end && db.start <= da.end;
  if (!daysIntersect) return null;

  // Any trip involvement: the date ranges definitively intersect.
  if (a.kind === "range" || b.kind === "range") return "hard";

  // Two events on the same day.
  if (a.kind === "timed" && b.kind === "timed") {
    return a.startMs < b.endMs && b.startMs < a.endMs ? "hard" : null;
  }
  // Either lacks a concrete time → same-day soft conflict.
  return "soft";
}

/** Is this plan on the user's own calendar (they're actually part of it)? */
export function isOwnPlan(plan: Event, userId: string, squads: Squad[]): boolean {
  if (plan.type === "trip") {
    const squad = squads.find((s) => s.id === plan.squadId);
    return attendingIds(plan, squad?.memberIds ?? []).includes(userId);
  }
  const rsvp = plan.rsvps?.[userId];
  return plan.hostId === userId || rsvp === "going" || rsvp === "maybe";
}

/**
 * Find the current user's own plans that collide with a candidate span.
 * `excludeId` should be the plan being created/joined, so it never conflicts
 * with itself.
 */
export function findMyConflicts(opts: {
  candidate: PlanSpan | null;
  plans: Event[];
  userId: string;
  squads: Squad[];
  excludeId?: string;
}): PlanConflict[] {
  const { candidate, plans, userId, squads, excludeId } = opts;
  if (!candidate) return [];
  const out: PlanConflict[] = [];
  for (const plan of plans) {
    if (plan.id === excludeId || plan.cancelled) continue;
    if (!isOwnPlan(plan, userId, squads)) continue;
    const span = getPlanSpan(plan);
    if (!span) continue;
    const level = spansOverlap(candidate, span);
    if (level) out.push({ plan, level });
  }
  return out;
}

/** User-facing banner copy. Never blocks anything — it's a heads-up only. */
export function conflictMessage(conflicts: PlanConflict[]): string | null {
  if (conflicts.length === 0) return null;
  if (conflicts.length === 1) {
    const { plan, level } = conflicts[0];
    const where = plan.squadName ? ` in ${plan.squadName}` : "";
    return level === "soft"
      ? `Heads up — ${plan.title}${where} is also on this day.`
      : `Heads up — this overlaps with ${plan.title}${where}.`;
  }
  return `This overlaps with ${conflicts.length} other plans on your calendar.`;
}
