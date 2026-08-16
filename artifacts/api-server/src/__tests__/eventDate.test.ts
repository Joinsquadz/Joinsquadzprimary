import { describe, it, expect } from "vitest";
import { parseEventStart, calendarDaysUntil, formatEventTimeIn } from "../lib/eventDate";

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

// ---------------------------------------------------------------------------
// calendarDaysUntil
// ---------------------------------------------------------------------------

describe("calendarDaysUntil", () => {
  // Reference anchor: Thursday 2026-07-16 at 22:00 UTC.
  const THU_22_UTC = new Date("2026-07-16T22:00:00Z");
  // Friday 08:00 UTC — next calendar day in UTC.
  const FRI_8_UTC = new Date("2026-07-17T08:00:00Z");
  // Friday 02:00 UTC — next calendar day in UTC but still Thu evening in UTC-5.
  const FRI_2_UTC = new Date("2026-07-17T02:00:00Z");
  // Saturday midnight UTC.
  const SAT_UTC = new Date("2026-07-18T00:00:00Z");

  it("returns 0 when both timestamps are on the same UTC calendar day", () => {
    const sameDay = new Date("2026-07-16T10:00:00Z");
    expect(calendarDaysUntil(sameDay, THU_22_UTC, "UTC")).toBe(0);
  });

  it("returns 1 when start is the next UTC calendar day", () => {
    expect(calendarDaysUntil(THU_22_UTC, FRI_8_UTC, "UTC")).toBe(1);
  });

  it("returns 2 when start is two UTC calendar days ahead", () => {
    expect(calendarDaysUntil(THU_22_UTC, SAT_UTC, "UTC")).toBe(2);
  });

  it("returns negative when start is in the past", () => {
    expect(calendarDaysUntil(FRI_8_UTC, THU_22_UTC, "UTC")).toBe(-1);
  });

  it("timezone fix: Fri 02:00 UTC is still Thu evening in America/New_York (UTC-4 summer) → daysUntil=0", () => {
    // now: Thu 22:00 UTC = Thu 18:00 EDT
    // start: Fri 02:00 UTC = Thu 22:00 EDT  → SAME calendar day → 0
    expect(calendarDaysUntil(THU_22_UTC, FRI_2_UTC, "America/New_York")).toBe(0);
    // But in UTC it looks like the next day → 1.
    expect(calendarDaysUntil(THU_22_UTC, FRI_2_UTC, "UTC")).toBe(1);
  });

  it("timezone fix: Thu 22:00 UTC is already Fri in Asia/Karachi (UTC+5) → start on same day as event → 0", () => {
    // now: Thu 22:00 UTC = Fri 03:00 PKT
    // start: Fri 08:00 UTC = Fri 13:00 PKT → same calendar day → 0
    expect(calendarDaysUntil(THU_22_UTC, FRI_8_UTC, "Asia/Karachi")).toBe(0);
    // UTC interpretation: Fri is 1 day after Thu.
    expect(calendarDaysUntil(THU_22_UTC, FRI_8_UTC, "UTC")).toBe(1);
  });

  it("falls back to UTC when timezone is null", () => {
    expect(calendarDaysUntil(THU_22_UTC, FRI_8_UTC, null)).toBe(1);
  });

  it("falls back to UTC when timezone is undefined", () => {
    expect(calendarDaysUntil(THU_22_UTC, FRI_8_UTC, undefined)).toBe(1);
  });

  it("falls back gracefully for an invalid timezone (no throw, UTC result)", () => {
    expect(() => calendarDaysUntil(THU_22_UTC, FRI_8_UTC, "Fake/Zone")).not.toThrow();
    expect(calendarDaysUntil(THU_22_UTC, FRI_8_UTC, "Fake/Zone")).toBe(1);
  });
});

describe("formatEventTimeIn", () => {
  // 2026-07-16T02:00:00Z = Jul 15, 7:00 PM in Los Angeles (PDT) but already
  // Jul 16, 11:00 AM in Tokyo — the same instant on two calendar days.
  const INSTANT = new Date("2026-07-16T02:00:00.000Z");

  it("renders the instant on the reader's clock, not the server's", () => {
    expect(formatEventTimeIn(INSTANT, "America/Los_Angeles")).toBe("Wed, Jul 15 · 7:00 PM PDT");
    expect(formatEventTimeIn(INSTANT, "Asia/Tokyo")).toBe("Thu, Jul 16 · 11:00 AM GMT+9");
  });

  it("uses daylight-aware abbreviations rather than a fixed per-zone string", () => {
    const summer = formatEventTimeIn(new Date("2026-07-16T19:00:00.000Z"), "America/New_York");
    const winter = formatEventTimeIn(new Date("2026-01-16T19:00:00.000Z"), "America/New_York");
    expect(summer).toContain("EDT");
    expect(winter).toContain("EST");
  });

  it("returns null for a missing or unusable timezone so callers can fall back", () => {
    expect(formatEventTimeIn(INSTANT, null)).toBeNull();
    expect(formatEventTimeIn(INSTANT, undefined)).toBeNull();
    expect(formatEventTimeIn(INSTANT, "")).toBeNull();
    expect(formatEventTimeIn(INSTANT, "Not/AZone")).toBeNull();
  });

  it("returns null for an invalid date", () => {
    expect(formatEventTimeIn(new Date("nope"), "UTC")).toBeNull();
  });
});
