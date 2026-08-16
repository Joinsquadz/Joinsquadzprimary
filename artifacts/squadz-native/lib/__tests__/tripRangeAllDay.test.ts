import { describe, it, expect } from "vitest";
import { formatTripRangeIn } from "@/lib/timezoneFormat";

/**
 * Trips default to all-day. Their stored instants are *synthetic* creator-local
 * anchors (9 AM start / 6 PM end), not real clock times — so converting them to
 * a distant viewer's zone drags them across midnight and renders the wrong
 * calendar dates. An all-day range must show the authored dates to everyone.
 */

// 9 AM Jul 18 → 6 PM Jul 22, anchored in Los Angeles.
const ALL_DAY_TRIP = {
  date: "Jul 18 – 22, 2026",
  startAt: "2026-07-18T16:00:00.000Z",
  endAt: "2026-07-23T01:00:00.000Z",
  allDay: true,
};

describe("formatTripRangeIn — all-day trips", () => {
  it("shows the same authored dates regardless of viewer zone", () => {
    // The 6 PM Pacific end anchor is already Jul 23 in Tokyo; converting would
    // show "Jul 19 – 23" to a viewer there for a trip authored as Jul 18 – 22.
    for (const zone of ["America/Los_Angeles", "America/New_York", "Asia/Tokyo", "Pacific/Kiritimati", "Pacific/Midway"]) {
      expect(formatTripRangeIn(ALL_DAY_TRIP, zone)).toBe("Jul 18 – 22, 2026");
    }
  });

  it("does not shift the range for a viewer far east of the creator", () => {
    const tokyo = formatTripRangeIn(ALL_DAY_TRIP, "Asia/Tokyo");
    expect(tokyo).not.toContain("Jul 19");
    expect(tokyo).not.toContain("Jul 23");
  });

  it("falls back to converting only when an all-day trip has no stored text", () => {
    const noText = { ...ALL_DAY_TRIP, date: "" };
    expect(formatTripRangeIn(noText, "America/Los_Angeles")).toBe("Jul 18 – 22, 2026");
  });
});

describe("formatTripRangeIn — timed trips", () => {
  const TIMED_TRIP = {
    date: "Jul 18 – 22, 2026",
    startAt: "2026-07-18T16:00:00.000Z",
    endAt: "2026-07-23T01:00:00.000Z",
    allDay: false,
  };

  it("converts a timed range to the viewer's clock", () => {
    expect(formatTripRangeIn(TIMED_TRIP, "America/Los_Angeles")).toBe("Jul 18 – 22, 2026");
    // A real timed range genuinely does land on different days elsewhere.
    expect(formatTripRangeIn(TIMED_TRIP, "Asia/Tokyo")).toBe("Jul 19 – 23, 2026");
  });

  it("keeps the stored text when a timed trip has no start instant", () => {
    expect(
      formatTripRangeIn({ date: "Dates TBD", startAt: null, endAt: null, allDay: false }, "Asia/Tokyo"),
    ).toBe("Dates TBD");
  });
});
