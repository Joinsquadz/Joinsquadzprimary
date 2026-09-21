const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export function parseEventStart(
  dateStr: string | null | undefined,
  year = new Date().getFullYear(),
): Date | null {
  if (!dateStr) return null;
  const dm = dateStr.match(/([A-Z][a-z]{2})\s+(\d{1,2})/);
  if (!dm || !(dm[1] in MONTHS)) return null;
  const month = MONTHS[dm[1]];
  const day = parseInt(dm[2], 10);

  let hours = 18;
  let minutes = 0;
  const tm = dateStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (tm) {
    hours = parseInt(tm[1], 10) % 12;
    if (/PM/i.test(tm[3])) hours += 12;
    minutes = parseInt(tm[2], 10);
  }

  let result = new Date(year, month, day, hours, minutes, 0, 0);
  // The display string has no year. If the parsed date already rolled well
  // into the past (e.g. a "Jan" event read in December), assume next year.
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  if (result.getTime() < Date.now() - THIRTY_DAYS) {
    result = new Date(year + 1, month, day, hours, minutes, 0, 0);
  }
  return result;
}

/**
 * The event's true start *instant*, for anything that does time math:
 * countdowns, past/upcoming checks, reminder scheduling.
 *
 * Prefer the stored absolute timestamp. `parseEventStart` is a legacy fallback
 * only — it reads a year-less wall-clock string as the *device's* local time,
 * so for a viewer in another timezone it silently yields the wrong moment (a
 * countdown hours off, an RSVP nudge fired on the wrong day). Events created
 * before absolute timestamps existed have nothing else to go on.
 */
export function resolveEventStart(
  plan: { date?: string | null; eventAt?: string | null; startAt?: string | null } | null | undefined,
): Date | null {
  if (!plan) return null;
  for (const iso of [plan.startAt, plan.eventAt]) {
    if (!iso) continue;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return parseEventStart(plan.date ?? "");
}

type PlanForCompletion = {
  type?: "event" | "trip";
  date?: string | null;
  eventAt?: string | null;
  startAt?: string | null;
  endAt?: string | null;
};

/**
 * The instant a plain event is complete. A valid explicit end wins; events
 * without one retain the historical start-time fallback.
 */
export function resolveEventCompletion(
  event: Omit<PlanForCompletion, "type"> | null | undefined,
): Date | null {
  if (!event) return null;
  if (event.endAt) {
    const end = new Date(event.endAt);
    if (!Number.isNaN(end.getTime())) return end;
  }
  return resolveEventStart(event);
}

export function isEventPast(
  event: Omit<PlanForCompletion, "type"> | null | undefined,
  now = new Date(),
): boolean {
  const completion = resolveEventCompletion(event);
  return completion != null && completion.getTime() < now.getTime();
}

/**
 * Milliseconds until the next plain event completes. Already-completed events
 * and trips are ignored so callers can safely use this to schedule a UI update
 * without changing trip end-of-day behavior.
 */
export function nextEventCompletionDelay(
  plans: readonly PlanForCompletion[],
  now = new Date(),
): number | null {
  const nowMs = now.getTime();
  let nextDelay: number | null = null;

  for (const plan of plans) {
    if (plan.type === "trip") continue;
    const completion = resolveEventCompletion(plan);
    if (!completion) continue;
    const delay = completion.getTime() - nowMs;
    if (delay < 0) continue;
    if (nextDelay === null || delay < nextDelay) nextDelay = delay;
  }

  return nextDelay;
}

/**
 * The instant a plan is considered complete for archive ordering. Trips sort by
 * their final day; one-off events sort by their explicit end when available,
 * otherwise by their start. This deliberately uses persisted instants rather
 * than the creator's display text, which has no timezone or reliable year.
 */
export function resolvePlanCompletion(plan: PlanForCompletion): Date | null {
  if (plan.type === "trip") {
    for (const iso of [plan.endAt, plan.startAt, plan.eventAt]) {
      if (!iso) continue;
      const date = new Date(iso);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return resolveEventStart(plan);
  }
  return resolveEventCompletion(plan);
}

/**
 * Returns a new archive list ordered most-recently-completed first. Plans with
 * no usable instant retain their relative source order at the end.
 */
export function sortPastPlansNewestFirst<T extends PlanForCompletion>(plans: readonly T[]): T[] {
  return plans
    .map((plan, index) => ({ plan, index, completedAt: resolvePlanCompletion(plan)?.getTime() ?? null }))
    .sort((a, b) => {
      if (a.completedAt === null && b.completedAt === null) return a.index - b.index;
      if (a.completedAt === null) return 1;
      if (b.completedAt === null) return -1;
      return b.completedAt - a.completedAt || a.index - b.index;
    })
    .map(({ plan }) => plan);
}
