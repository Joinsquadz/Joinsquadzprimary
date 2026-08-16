import { describe, it, expect } from "vitest";
import {
  formatEventTimeIn,
  formatInstantIn,
  formatRangeIn,
  zoneAbbreviation,
  zoneLabel,
} from "@/lib/timezoneFormat";

// 2026-07-16T01:00:00Z = Jul 15, 6:00 PM in Los Angeles but Jul 16, 10:00 AM in
// Tokyo — the same instant landing on two different calendar days.
const INSTANT = "2026-07-16T01:00:00.000Z";

describe("formatInstantIn", () => {
  it("renders the same instant on each viewer's clock", () => {
    expect(formatInstantIn(new Date(INSTANT), "America/Los_Angeles")).toBe(
      "Wed, Jul 15 · 6:00 PM PDT",
    );
    expect(formatInstantIn(new Date(INSTANT), "Asia/Tokyo")).toBe("Thu, Jul 16 · 10:00 AM GMT+9");
  });

  it("returns an empty string for an unusable zone so callers can fall back", () => {
    expect(formatInstantIn(new Date(INSTANT), "Not/AZone")).toBe("");
  });
});

describe("zoneAbbreviation", () => {
  it("is daylight-aware rather than a fixed per-zone string", () => {
    expect(zoneAbbreviation(new Date("2026-07-16T19:00:00Z"), "America/New_York")).toBe("EDT");
    expect(zoneAbbreviation(new Date("2026-01-16T19:00:00Z"), "America/New_York")).toBe("EST");
    expect(zoneAbbreviation(new Date("2026-07-16T19:00:00Z"), "America/Los_Angeles")).toBe("PDT");
    expect(zoneAbbreviation(new Date("2026-01-16T19:00:00Z"), "America/Los_Angeles")).toBe("PST");
  });

  it("degrades to the zone id when the runtime rejects the zone", () => {
    expect(zoneAbbreviation(new Date(INSTANT), "Not/AZone")).toBe("Not/AZone");
  });
});

describe("zoneLabel", () => {
  it("reads as a city plus its current abbreviation", () => {
    expect(zoneLabel("America/Los_Angeles", new Date("2026-07-16T19:00:00Z"))).toBe(
      "Los Angeles (PDT)",
    );
    // Underscores are an IANA encoding detail, not something to show a user.
    expect(zoneLabel("America/New_York", new Date("2026-01-16T19:00:00Z"))).toBe("New York (EST)");
  });
});

describe("formatEventTimeIn", () => {
  const base = { date: "Wed, Jul 15 · 6:00 PM", eventAt: INSTANT };

  it("converts the absolute start into the viewer's zone", () => {
    expect(formatEventTimeIn(base, "America/Los_Angeles")).toBe("Wed, Jul 15 · 6:00 PM PDT");
    expect(formatEventTimeIn(base, "Asia/Tokyo")).toBe("Thu, Jul 16 · 10:00 AM GMT+9");
  });

  it("prefers startAt over eventAt when both are present", () => {
    const withStart = { ...base, startAt: "2026-07-16T03:00:00.000Z" };
    expect(formatEventTimeIn(withStart, "America/Los_Angeles")).toBe("Wed, Jul 15 · 8:00 PM PDT");
  });

  it("keeps the stored text for all-day, TBD, and legacy events", () => {
    // All-day: no meaningful clock time to convert.
    expect(formatEventTimeIn({ ...base, allDay: true }, "Asia/Tokyo")).toBe("Wed, Jul 15 · 6:00 PM");
    // TBD / legacy: no absolute timestamp exists at all.
    expect(formatEventTimeIn({ date: "TBD" }, "Asia/Tokyo")).toBe("TBD");
    expect(formatEventTimeIn({ date: "Sometime in Aug", eventAt: null }, "Asia/Tokyo")).toBe(
      "Sometime in Aug",
    );
  });

  it("falls back to the stored text when the timestamp is unparseable", () => {
    expect(formatEventTimeIn({ date: "Wed, Jul 15 · 6:00 PM", eventAt: "nonsense" }, "UTC")).toBe(
      "Wed, Jul 15 · 6:00 PM",
    );
  });
});

describe("formatRangeIn", () => {
  it("collapses a same-day range to a single date", () => {
    expect(formatRangeIn(INSTANT, INSTANT, "America/Los_Angeles")).toBe("Jul 15, 2026");
  });

  it("shares the month when both ends fall in it", () => {
    expect(
      formatRangeIn("2026-07-18T15:00:00Z", "2026-07-22T15:00:00Z", "America/Los_Angeles"),
    ).toBe("Jul 18 – 22, 2026");
  });

  it("spells out both months across a boundary", () => {
    expect(
      formatRangeIn("2026-07-28T15:00:00Z", "2026-08-02T15:00:00Z", "America/Los_Angeles"),
    ).toBe("Jul 28 – Aug 2, 2026");
  });

  it("computes the range on the viewer's calendar, not the server's", () => {
    // Same two instants; in Tokyo both have already rolled to the next day.
    expect(formatRangeIn("2026-07-18T15:00:00Z", "2026-07-22T15:00:00Z", "Asia/Tokyo")).toBe(
      "Jul 19 – 23, 2026",
    );
  });

  it("says Dates TBD when there is no usable start", () => {
    expect(formatRangeIn(null, null, "UTC")).toBe("Dates TBD");
    expect(formatRangeIn("nonsense", null, "UTC")).toBe("Dates TBD");
    expect(formatRangeIn(INSTANT, INSTANT, "Not/AZone")).toBe("Dates TBD");
  });

  it("treats a missing end as a one-day range", () => {
    expect(formatRangeIn(INSTANT, null, "America/Los_Angeles")).toBe("Jul 15, 2026");
  });
});
