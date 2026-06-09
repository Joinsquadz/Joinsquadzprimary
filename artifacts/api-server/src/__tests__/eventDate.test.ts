import { describe, it, expect } from "vitest";
import { parseEventStart } from "../lib/eventDate";

describe("parseEventStart", () => {
  const NOW = new Date("2026-06-01T12:00:00.000Z");

  it("returns null for empty / TBD / nullish input", () => {
    expect(parseEventStart("", NOW)).toBeNull();
    expect(parseEventStart("   ", NOW)).toBeNull();
    expect(parseEventStart("TBD", NOW)).toBeNull();
    expect(parseEventStart("tbd", NOW)).toBeNull();
    expect(parseEventStart(null, NOW)).toBeNull();
    expect(parseEventStart(undefined, NOW)).toBeNull();
  });

  it("parses the app's year-less format with the '·' separator", () => {
    // "Sat, Jun 7 · 5:00 PM" → June 7 17:00 local time, current year.
    const d = parseEventStart("Sat, Jun 7 · 5:00 PM", NOW);
    expect(d).not.toBeNull();
    expect(d!.getMonth()).toBe(5); // June
    expect(d!.getDate()).toBe(7);
    expect(d!.getHours()).toBe(17);
    expect(d!.getMinutes()).toBe(0);
    expect(d!.getFullYear()).toBe(2026);
  });

  it("handles AM and 12-hour wraparound correctly", () => {
    const noon = parseEventStart("Mon, Jun 8 · 12:00 PM", NOW);
    expect(noon!.getHours()).toBe(12);
    const midnight = parseEventStart("Mon, Jun 8 · 12:30 AM", NOW);
    expect(midnight!.getHours()).toBe(0);
    expect(midnight!.getMinutes()).toBe(30);
    const morning = parseEventStart("Mon, Jun 8 · 9:15 AM", NOW);
    expect(morning!.getHours()).toBe(9);
  });

  it("rolls a long-past month into next year (year inference)", () => {
    // "Jan 2" is months in the past relative to June; assume next year.
    const d = parseEventStart("Fri, Jan 2 · 8:00 PM", NOW);
    expect(d!.getFullYear()).toBe(2027);
    expect(d!.getMonth()).toBe(0);
    expect(d!.getDate()).toBe(2);
  });

  it("keeps a date within the recent-past grace window in the current year", () => {
    // Yesterday relative to NOW should stay this year, not jump forward.
    const d = parseEventStart("Sun, May 31 · 6:00 PM", NOW);
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(4); // May
  });

  it("falls back to the native parser for ISO-ish strings", () => {
    const d = parseEventStart("2026-07-04T18:30:00.000Z", NOW);
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-07-04T18:30:00.000Z");
  });

  it("returns null for unrecognised free text", () => {
    expect(parseEventStart("sometime next week", NOW)).toBeNull();
    expect(parseEventStart("whenever", NOW)).toBeNull();
  });
});
