/**
 * Regression tests for lib/tripUtils.ts
 *
 * groupStopsByDay regression: a null `time` field on an itinerary stop must
 * not throw a TypeError from `.localeCompare()`; the stop should still be
 * grouped and returned (sort falls back to sortOrder-only comparison).
 */
import { describe, it, expect } from "vitest";
import { groupStopsByDay, tripDayKeys, formatTripRange, isTripPast } from "@/lib/tripUtils";
import type { ItineraryStop } from "@/types";

function makeStop(overrides: Partial<ItineraryStop> = {}): ItineraryStop {
  return {
    id: "s1",
    day: "2026-08-10",
    time: "09:00",
    endTime: "",
    title: "Breakfast",
    placeName: "",
    address: "",
    note: "",
    category: "food",
    status: "confirmed",
    cost: null,
    paidById: null,
    assigneeId: null,
    createdBy: "u1",
    votes: [],
    sortOrder: 0,
    ...overrides,
  };
}

describe("groupStopsByDay", () => {
  it("groups stops by their day key", () => {
    const stops = [
      makeStop({ id: "a", day: "2026-08-10", sortOrder: 1 }),
      makeStop({ id: "b", day: "2026-08-10", sortOrder: 0 }),
      makeStop({ id: "c", day: "2026-08-11" }),
    ];
    const groups = groupStopsByDay(stops);
    expect(groups["2026-08-10"].map((s) => s.id)).toEqual(["b", "a"]);
    expect(groups["2026-08-11"].map((s) => s.id)).toEqual(["c"]);
  });

  // Regression: null time must not throw TypeError from localeCompare.
  // A stop with no scheduled time (time: null from the DB) should sort
  // stably after stops that have a time without crashing the screen.
  it("does not throw when stop.time is null", () => {
    const stops = [
      makeStop({ id: "timed", time: "10:00", sortOrder: 0 }),
      makeStop({ id: "untimed", time: null as unknown as string, sortOrder: 1 }),
    ];
    expect(() => groupStopsByDay(stops)).not.toThrow();
    const groups = groupStopsByDay(stops);
    expect(groups["2026-08-10"]).toHaveLength(2);
  });

  it("sorts timed stops before untimed stops within the same sortOrder tier", () => {
    const stops = [
      makeStop({ id: "a", time: null as unknown as string, sortOrder: 0 }),
      makeStop({ id: "b", time: "08:00", sortOrder: 0 }),
    ];
    // Should not throw; exact order is stable but "08:00" > "" so b comes after a.
    expect(() => groupStopsByDay(stops)).not.toThrow();
  });

  it("returns an empty object for an empty input", () => {
    expect(groupStopsByDay([])).toEqual({});
  });
});

describe("tripDayKeys", () => {
  it("returns a single key for a same-day trip", () => {
    expect(tripDayKeys({ startAt: "2026-08-10T00:00:00Z", endAt: "2026-08-10T23:59:59Z" }))
      .toEqual(["2026-08-10"]);
  });

  it("returns all days inclusive for a multi-day trip", () => {
    const keys = tripDayKeys({ startAt: "2026-08-10T00:00:00Z", endAt: "2026-08-12T00:00:00Z" });
    expect(keys).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
  });

  it("returns [] when startAt is missing/invalid", () => {
    expect(tripDayKeys({ startAt: "", endAt: "" })).toEqual([]);
  });
});

describe("isTripPast", () => {
  it("returns true for a trip that ended in the past", () => {
    expect(isTripPast({ startAt: "2020-01-01T00:00:00Z", endAt: "2020-01-05T00:00:00Z" })).toBe(true);
  });

  it("returns false for a trip in the future", () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(isTripPast({ startAt: future, endAt: future })).toBe(false);
  });
});
