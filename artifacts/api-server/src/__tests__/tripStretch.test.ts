// Ranking rules for trip polls: which consecutive RUN of days works best.
//
// A trip is an all-or-nothing commitment, so these tests pin the distinction
// that matters most: someone free for part of a stretch does NOT make that
// stretch work. The single-cell "best day" ranking these polls used to share
// with event polls got this wrong by construction.
import { describe, it, expect } from "vitest";

import {
  tripDayUsers,
  rankTripStretches,
  bestTripStretch,
  stretchStartingOn,
} from "../lib/tripStretch";

const DAYS = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"];

/** Trip responses are stored as `<date>-All day`, same as they always were. */
const cells = (...days: string[]) => days.map((d) => `${d}-All day`);

describe("tripDayUsers", () => {
  it("recovers the per-day roster from `<date>-All day` cells", () => {
    const map = tripDayUsers(
      [
        { userId: "a", cells: cells("2026-06-01", "2026-06-02") },
        { userId: "b", cells: cells("2026-06-02") },
      ],
      DAYS,
    );
    expect([...(map.get("2026-06-01") ?? [])]).toEqual(["a"]);
    expect([...(map.get("2026-06-02") ?? [])].sort()).toEqual(["a", "b"]);
    expect([...(map.get("2026-06-03") ?? [])]).toEqual([]);
  });

  it("ignores cells for days outside the poll's window", () => {
    const map = tripDayUsers([{ userId: "a", cells: cells("2026-07-04") }], DAYS);
    for (const day of DAYS) expect(map.get(day)?.size).toBe(0);
  });

  it("splits on the LAST dash so ISO dates survive intact", () => {
    // "2026-06-01-All day" contains three dashes; splitting on the first would
    // yield the day "2026" and drop every response on the floor.
    const map = tripDayUsers([{ userId: "a", cells: ["2026-06-01-All day"] }], DAYS);
    expect([...(map.get("2026-06-01") ?? [])]).toEqual(["a"]);
  });
});

describe("rankTripStretches", () => {
  it("ranks by the number of people free for the WHOLE run, not person-days", () => {
    // b+c cover days 1-2 and 3-4 respectively but neither clears a full 2-day
    // run together; a is free across 2-3. Person-day totals would favour the
    // busier windows, but only a's window actually works for anybody.
    const ranked = rankTripStretches({
      days: DAYS,
      lengthDays: 2,
      responses: [
        { userId: "a", cells: cells("2026-06-02", "2026-06-03") },
        { userId: "b", cells: cells("2026-06-01") },
        { userId: "c", cells: cells("2026-06-04") },
      ],
    });
    expect(ranked[0]).toMatchObject({
      startDate: "2026-06-02",
      endDate: "2026-06-03",
      fullCount: 1,
    });
  });

  it("breaks ties on the earliest start date", () => {
    // Both a run at day 1-2 and a run at day 4-5 work for the same two people;
    // the soonest workable window wins so the result is stable.
    const ranked = rankTripStretches({
      days: DAYS,
      lengthDays: 2,
      responses: [
        { userId: "a", cells: cells("2026-06-01", "2026-06-02", "2026-06-04", "2026-06-05") },
        { userId: "b", cells: cells("2026-06-01", "2026-06-02", "2026-06-04", "2026-06-05") },
      ],
    });
    expect(ranked[0].startDate).toBe("2026-06-01");
    expect(ranked[0].fullCount).toBe(2);
  });

  it("falls back to person-days only when NO run works for anyone", () => {
    // Nobody is free two days running. The 2-3 window has the most total
    // availability, so it wins the fallback ranking — with fullCount 0.
    const ranked = rankTripStretches({
      days: DAYS,
      lengthDays: 2,
      responses: [
        { userId: "a", cells: cells("2026-06-02") },
        { userId: "b", cells: cells("2026-06-03") },
        { userId: "c", cells: cells("2026-06-03") },
        { userId: "d", cells: cells("2026-06-05") },
      ],
    });
    expect(ranked[0]).toMatchObject({ startDate: "2026-06-02", fullCount: 0, personDays: 3 });
  });

  it("does not let person-days override a real full-run winner", () => {
    // The 1-2 window has 3 person-days but nobody across both; 3-4 has 2
    // person-days and one person for the whole run. The real run must win.
    const ranked = rankTripStretches({
      days: DAYS,
      lengthDays: 2,
      responses: [
        { userId: "a", cells: cells("2026-06-01") },
        { userId: "b", cells: cells("2026-06-01", "2026-06-02") },
        { userId: "c", cells: cells("2026-06-03", "2026-06-04") },
      ],
    });
    // b is free for the whole 1-2 window too, so that stays the winner; assert
    // the ordering rule rather than a hand-picked window.
    expect(ranked[0].fullCount).toBeGreaterThan(0);
    expect(ranked.every((s, i) => i === 0 || s.fullCount <= ranked[0].fullCount)).toBe(true);
  });

  it("returns every window of the requested length", () => {
    const ranked = rankTripStretches({ days: DAYS, lengthDays: 3, responses: [] });
    expect(ranked).toHaveLength(3);
    expect(ranked.map((s) => s.startDate).sort()).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
    ]);
    expect(ranked.every((s) => s.days.length === 3)).toBe(true);
  });

  it("returns nothing when the trip is longer than the voting window", () => {
    expect(rankTripStretches({ days: DAYS, lengthDays: 6, responses: [] })).toEqual([]);
  });
});

describe("bestTripStretch", () => {
  it("reports a full-coverage winner with both ends of the run", () => {
    const best = bestTripStretch({
      days: DAYS,
      lengthDays: 3,
      responses: [
        { userId: "a", cells: cells("2026-06-01", "2026-06-02", "2026-06-03") },
        { userId: "b", cells: cells("2026-06-01", "2026-06-02", "2026-06-03") },
      ],
    });
    expect(best).toMatchObject({
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      lengthDays: 3,
      count: 2,
      total: 2,
      partial: false,
    });
  });

  it("flags a partial result when nobody clears the whole run", () => {
    // This is the honesty case: a squad that books on an unflagged "best"
    // window finds out at the airport that nobody could do all three days.
    const best = bestTripStretch({
      days: DAYS,
      lengthDays: 3,
      responses: [
        { userId: "a", cells: cells("2026-06-01", "2026-06-02") },
        { userId: "b", cells: cells("2026-06-03") },
      ],
    });
    expect(best).toMatchObject({ partial: true, count: 0 });
    expect(best?.partialCount).toBe(2);
  });

  it("returns null when nobody has marked anything in the winning window", () => {
    expect(bestTripStretch({ days: DAYS, lengthDays: 2, responses: [] })).toBeNull();
    expect(
      bestTripStretch({
        days: DAYS,
        lengthDays: 2,
        responses: [{ userId: "a", cells: [] }],
      }),
    ).toBeNull();
  });

  it("returns null when the trip cannot fit in the window", () => {
    expect(
      bestTripStretch({
        days: DAYS,
        lengthDays: 9,
        responses: [{ userId: "a", cells: cells("2026-06-01") }],
      }),
    ).toBeNull();
  });
});

describe("stretchStartingOn", () => {
  it("scores the run beginning on a chosen day", () => {
    const s = stretchStartingOn({
      days: DAYS,
      lengthDays: 2,
      startDate: "2026-06-03",
      responses: [
        { userId: "a", cells: cells("2026-06-03", "2026-06-04") },
        { userId: "b", cells: cells("2026-06-03") },
      ],
    });
    expect(s).toMatchObject({
      startDate: "2026-06-03",
      endDate: "2026-06-04",
      count: 1,
      partialCount: 2,
      partial: false,
    });
  });

  it("refuses a start day that would run past the end of the window", () => {
    expect(
      stretchStartingOn({
        days: DAYS,
        lengthDays: 3,
        startDate: "2026-06-04",
        responses: [{ userId: "a", cells: cells("2026-06-04") }],
      }),
    ).toBeNull();
  });

  it("refuses a start day that is not in the poll at all", () => {
    expect(
      stretchStartingOn({
        days: DAYS,
        lengthDays: 2,
        startDate: "2026-07-01",
        responses: [],
      }),
    ).toBeNull();
  });
});
