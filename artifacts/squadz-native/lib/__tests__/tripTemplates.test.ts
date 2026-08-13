/**
 * Regression tests for lib/tripTemplates.ts
 *
 * A template's length is only a suggestion. When someone locks in an
 * availability winner that is shorter than the template, the created trip must
 * not carry stops on days outside the range they actually chose — otherwise
 * they have to delete them by hand right after creation.
 */
import { describe, it, expect } from "vitest";
import { materializeTemplateStops, type TripTemplate } from "@/lib/tripTemplates";

const template: TripTemplate = {
  id: "test",
  emoji: "🏝️",
  title: "Test trip",
  tagline: "",
  coverStyle: "ocean",
  nights: 3,
  stops: [
    { dayIndex: 0, time: "3:00 PM", title: "Check in", placeName: "Rental", category: "lodging" },
    { dayIndex: 0, time: "7:00 PM", title: "Dinner", placeName: "Seafood", category: "food" },
    { dayIndex: 1, time: "10:00 AM", title: "Beach", placeName: "Main beach", category: "activity" },
    { dayIndex: 3, time: "11:00 AM", title: "Check out", placeName: "Rental", category: "lodging" },
  ],
};

const day = (iso: string) => new Date(`${iso}T12:00:00`);

describe("materializeTemplateStops", () => {
  it("places each stop on the calendar day its dayIndex points at", () => {
    const stops = materializeTemplateStops(template, day("2026-07-01"), day("2026-07-04"));
    expect(stops.map((s) => [s.title, s.day])).toEqual([
      ["Check in", "2026-07-01"],
      ["Dinner", "2026-07-01"],
      ["Beach", "2026-07-02"],
      ["Check out", "2026-07-04"],
    ]);
  });

  it("drops stops that fall past a shorter chosen range", () => {
    const stops = materializeTemplateStops(template, day("2026-07-01"), day("2026-07-02"));
    expect(stops.map((s) => s.day)).toEqual(["2026-07-01", "2026-07-01", "2026-07-02"]);
  });

  it("keeps only the first day for a single-day trip", () => {
    const stops = materializeTemplateStops(template, day("2026-07-01"), day("2026-07-01"));
    expect(stops.map((s) => s.title)).toEqual(["Check in", "Dinner"]);
  });

  it("crosses a month boundary without skipping days", () => {
    const stops = materializeTemplateStops(template, day("2026-07-30"), day("2026-08-02"));
    expect(stops.map((s) => s.day)).toEqual(["2026-07-30", "2026-07-30", "2026-07-31", "2026-08-02"]);
  });
});
