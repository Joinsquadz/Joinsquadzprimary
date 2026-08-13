/**
 * Best-stretch ranking for trip polls.
 *
 * A trip poll asks two independent questions: how wide a window people should
 * check ("days" — the voting window) and how long the trip itself runs
 * ("tripLengthDays"). The answer a squad actually needs is therefore not "which
 * single day suits the most people" but "which run of N consecutive days does
 * everyone survive".
 *
 * Kept free of Express/Drizzle so the ranking rules can be unit-tested directly.
 */

export type TripStretch = {
  /** First day of the run (an entry from the poll's `days`). */
  startDate: string;
  /** Last day of the run. */
  endDate: string;
  /** Every day in the run, in poll order. */
  days: string[];
  /** People free on EVERY day of the run. */
  fullCount: number;
  /** People free on at least one day of the run. */
  partialCount: number;
  /** Sum of per-day availability across the run (the fallback ranking key). */
  personDays: number;
};

/**
 * Trip availability is stored as `<date>-All day` cells — the same cell
 * identity trip polls have always used — so the per-day roster is recovered by
 * splitting each cell on its LAST dash (ISO dates contain dashes themselves).
 */
export function tripDayUsers(
  responses: { userId: string; cells: string[] }[],
  days: string[],
): Map<string, Set<string>> {
  const dayset = new Set(days);
  const out = new Map<string, Set<string>>();
  for (const day of days) out.set(day, new Set());
  for (const r of responses) {
    for (const cell of r.cells) {
      const i = cell.lastIndexOf("-");
      const day = i < 0 ? cell : cell.slice(0, i);
      if (!dayset.has(day)) continue;
      out.get(day)!.add(r.userId);
    }
  }
  return out;
}

/**
 * Every consecutive run of `lengthDays` days, best first.
 *
 * Primary ranking is the number of people free for the WHOLE run — a trip is
 * an all-or-nothing commitment, so someone free for three days of a four-day
 * trip does not make that window work. Ties break to the earliest start date so
 * the result is stable and the soonest workable window wins.
 *
 * When NOBODY clears a full run (every fullCount is zero), ranking falls back
 * to total person-days so the squad still gets the least-bad window — but the
 * caller must label that honestly rather than presenting it as a winner. See
 * `bestTripStretch`, which reports it as `partial`.
 */
export function rankTripStretches(input: {
  days: string[];
  lengthDays: number;
  responses: { userId: string; cells: string[] }[];
}): TripStretch[] {
  const { days, lengthDays } = input;
  if (lengthDays < 1 || days.length < lengthDays) return [];

  const dayUsers = tripDayUsers(input.responses, days);

  const stretches: TripStretch[] = [];
  for (let start = 0; start + lengthDays <= days.length; start++) {
    const window = days.slice(start, start + lengthDays);
    let full: Set<string> | null = null;
    const any = new Set<string>();
    let personDays = 0;
    for (const day of window) {
      const users = dayUsers.get(day) ?? new Set<string>();
      personDays += users.size;
      for (const u of users) any.add(u);
      if (full === null) {
        full = new Set(users);
      } else {
        for (const u of [...full]) if (!users.has(u)) full.delete(u);
      }
    }
    stretches.push({
      startDate: window[0],
      endDate: window[window.length - 1],
      days: window,
      fullCount: full?.size ?? 0,
      partialCount: any.size,
      personDays,
    });
  }

  const anyFull = stretches.some((s) => s.fullCount > 0);
  const startIndex = new Map(days.map((d, i) => [d, i]));
  return [...stretches].sort((a, b) => {
    if (anyFull) {
      if (b.fullCount !== a.fullCount) return b.fullCount - a.fullCount;
    } else if (b.personDays !== a.personDays) {
      return b.personDays - a.personDays;
    }
    return (startIndex.get(a.startDate) ?? 0) - (startIndex.get(b.startDate) ?? 0);
  });
}

export type BestTripStretch = {
  startDate: string;
  endDate: string;
  lengthDays: number;
  /** People free for the entire stretch. */
  count: number;
  /** People free for at least part of the stretch. */
  partialCount: number;
  /** Respondent total the counts are measured against. */
  total: number;
  /**
   * True when no run works for anybody end-to-end, so this is the least-bad
   * window rather than a real answer. The client must say so.
   */
  partial: boolean;
};

/**
 * The winning stretch, or null when there is nothing to rank (no responses at
 * all, or a window shorter than the trip).
 */
export function bestTripStretch(input: {
  days: string[];
  lengthDays: number;
  responses: { userId: string; cells: string[] }[];
}): BestTripStretch | null {
  const ranked = rankTripStretches(input);
  if (ranked.length === 0) return null;
  const top = ranked[0];
  // Nobody has marked a single day in the winning window — there is no result
  // to show yet, honest or otherwise.
  if (top.partialCount === 0) return null;
  return {
    startDate: top.startDate,
    endDate: top.endDate,
    lengthDays: input.lengthDays,
    count: top.fullCount,
    partialCount: top.partialCount,
    total: input.responses.length,
    partial: top.fullCount === 0,
  };
}

/**
 * The stretch that STARTS on a given day — what the creator gets by picking a
 * day out of the grid instead of taking the computed winner. Returns null when
 * the trip would run past the end of the voting window.
 */
export function stretchStartingOn(input: {
  days: string[];
  lengthDays: number;
  responses: { userId: string; cells: string[] }[];
  startDate: string;
}): BestTripStretch | null {
  const idx = input.days.indexOf(input.startDate);
  if (idx < 0 || idx + input.lengthDays > input.days.length) return null;
  const window = input.days.slice(idx, idx + input.lengthDays);
  const [only] = rankTripStretches({
    days: window,
    lengthDays: input.lengthDays,
    responses: input.responses,
  });
  if (!only) return null;
  return {
    startDate: only.startDate,
    endDate: only.endDate,
    lengthDays: input.lengthDays,
    count: only.fullCount,
    partialCount: only.partialCount,
    total: input.responses.length,
    partial: only.fullCount === 0,
  };
}
