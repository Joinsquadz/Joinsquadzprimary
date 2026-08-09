import { describe, it, expect } from "vitest";

import { buildPlanIcs, parseTimeLabel } from "../ics";
import type { Event, ItineraryStop } from "@/types";

const NOW = new Date("2026-07-05T12:00:00Z");

const stop = (over: Partial<ItineraryStop> & { id: string }): ItineraryStop => ({
  day: "2026-07-18",
  time: "",
  endTime: "",
  title: "Stop",
  placeName: "",
  address: "",
  note: "",
  category: "activity",
  status: "confirmed",
  cost: null,
  paidById: null,
  assigneeId: null,
  createdBy: "u1",
  votes: [],
  sortOrder: 0,
  ...over,
});

const plan = (over: Partial<Event> & { id: string }): Event => ({
  emoji: "🔥",
  title: "Bonfire",
  date: "Sat, Jul 18 · 8:00 PM",
  type: "event",
  location: "The Beach",
  squadId: "s1",
  squadName: "The Crew",
  hostId: "u1",
  rsvps: {},
  invitedUserIds: [],
  description: "",
  inviteCode: "abc",
  tasks: [],
  costs: [],
  polls: [],
  itinerary: [],
  packing: [],
  version: 1,
  ...over,
});

describe("parseTimeLabel", () => {
  it("parses 12h times", () => {
    expect(parseTimeLabel("9:00 AM")).toEqual({ hours: 9, minutes: 0 });
    expect(parseTimeLabel("12:30 PM")).toEqual({ hours: 12, minutes: 30 });
    expect(parseTimeLabel("12:15 AM")).toEqual({ hours: 0, minutes: 15 });
  });

  it("parses 24h times", () => {
    expect(parseTimeLabel("14:45")).toEqual({ hours: 14, minutes: 45 });
    expect(parseTimeLabel("0:05")).toEqual({ hours: 0, minutes: 5 });
  });

  it("rejects garbage", () => {
    expect(parseTimeLabel("")).toBeNull();
    expect(parseTimeLabel("evening")).toBeNull();
    expect(parseTimeLabel("25:00")).toBeNull();
    expect(parseTimeLabel("13:00 PM")).toBeNull();
  });
});

describe("buildPlanIcs — events", () => {
  it("uses eventAt as a UTC-timed VEVENT with 2h duration", () => {
    const ics = buildPlanIcs(plan({ id: "e1", eventAt: "2026-07-18T20:00:00.000Z" }), NOW);
    expect(ics).not.toBeNull();
    expect(ics!.content).toContain("DTSTART:20260718T200000Z");
    expect(ics!.content).toContain("DTEND:20260718T220000Z");
    expect(ics!.content).toContain("UID:e1@squadz");
    expect(ics!.content).toContain("SUMMARY:🔥 Bonfire");
    expect(ics!.content).toContain("LOCATION:The Beach");
  });

  it("falls back to a timed floating VEVENT when only the display date carries a time", () => {
    const ics = buildPlanIcs(plan({ id: "e2", date: "Sat, Jul 18 · 8:00 PM" }), NOW);
    expect(ics).not.toBeNull();
    // Floating (no Z) local time from the "8:00 PM" label.
    expect(ics!.content).toMatch(/DTSTART:\d{8}T200000(?!Z)/);
  });

  it("falls back to an all-day VEVENT when the display date has no time", () => {
    const ics = buildPlanIcs(plan({ id: "e3", date: "Sat, Jul 18" }), NOW);
    expect(ics).not.toBeNull();
    expect(ics!.content).toMatch(/DTSTART;VALUE=DATE:\d{8}/);
  });

  it("returns null when no date info is usable", () => {
    expect(buildPlanIcs(plan({ id: "e4", date: "sometime soon" }), NOW)).toBeNull();
  });

  it("omits TBD locations and escapes special characters", () => {
    const withTbd = buildPlanIcs(plan({ id: "e5", eventAt: "2026-07-18T20:00:00Z", location: "TBD" }), NOW);
    expect(withTbd!.content).not.toContain("LOCATION");

    const escaped = buildPlanIcs(
      plan({
        id: "e6",
        eventAt: "2026-07-18T20:00:00Z",
        title: "Dinner; drinks, maybe",
        description: "Line one\nLine two",
      }),
      NOW,
    );
    expect(escaped!.content).toContain("SUMMARY:🔥 Dinner\\; drinks\\, maybe");
    expect(escaped!.content).toContain("DESCRIPTION:Line one\\nLine two");
  });
});

describe("buildPlanIcs — trips", () => {
  const trip = (over: Partial<Event> = {}) =>
    plan({
      id: "t1",
      type: "trip",
      title: "Lake Weekend",
      date: "Jul 17–19",
      startAt: "2026-07-17T12:00:00.000Z",
      endAt: "2026-07-19T12:00:00.000Z",
      location: "Lake Tahoe",
      ...over,
    });

  it("emits an all-day span VEVENT with exclusive DTEND", () => {
    const ics = buildPlanIcs(trip(), NOW);
    expect(ics).not.toBeNull();
    const m = ics!.content.match(/DTSTART;VALUE=DATE:(\d{8})[\s\S]*?DTEND;VALUE=DATE:(\d{8})/);
    expect(m).not.toBeNull();
    // DTEND is the day AFTER the last day (RFC 5545 exclusive end).
    expect(parseInt(m![2], 10)).toBeGreaterThan(parseInt(m![1], 10));
    expect(ics!.content).toContain("UID:t1@squadz");
  });

  it("adds timed stops as floating-local VEVENTs in the same file", () => {
    const ics = buildPlanIcs(
      trip({
        itinerary: [
          stop({ id: "st1", day: "2026-07-18", time: "9:00 AM", title: "Kayaking", address: "North Dock" }),
          stop({ id: "st2", day: "2026-07-18", time: "", title: "Untimed hangout" }),
          stop({ id: "st3", day: "2026-07-18", time: "6:00 PM", endTime: "8:30 PM", title: "Dinner" }),
        ],
      }),
      NOW,
    );
    const c = ics!.content;
    expect(c).toContain("UID:t1-st1@squadz");
    expect(c).toContain("DTSTART:20260718T090000");
    expect(c).toContain("SUMMARY:Kayaking");
    expect(c).toContain("LOCATION:North Dock");
    // Untimed stop is skipped.
    expect(c).not.toContain("st2@squadz");
    // Explicit end time respected.
    expect(c).toContain("UID:t1-st3@squadz");
    expect(c).toContain("DTEND:20260718T203000");
    // All inside ONE calendar.
    expect(c.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
    expect(c.match(/BEGIN:VEVENT/g)).toHaveLength(3);
  });

  it("returns null for a trip without dates", () => {
    expect(buildPlanIcs(trip({ startAt: null, endAt: null, eventAt: null }), NOW)).toBeNull();
  });

  it("clamps an inverted range to the start day", () => {
    const ics = buildPlanIcs(
      trip({ startAt: "2026-07-19T12:00:00Z", endAt: "2026-07-17T12:00:00Z" }),
      NOW,
    );
    const m = ics!.content.match(/DTSTART;VALUE=DATE:(\d{8})[\s\S]*?DTEND;VALUE=DATE:(\d{8})/);
    // One-day event: exclusive end = start + 1 day.
    expect(parseInt(m![2], 10) - parseInt(m![1], 10)).toBe(1);
  });
});

describe("buildPlanIcs — formatting", () => {
  it("uses CRLF line endings and folds long lines to <=75 chars", () => {
    const longDesc = "x".repeat(300);
    const ics = buildPlanIcs(
      plan({ id: "e7", eventAt: "2026-07-18T20:00:00Z", description: longDesc }),
      NOW,
    );
    const lines = ics!.content.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
  });

  it("produces a safe filename", () => {
    const ics = buildPlanIcs(
      plan({ id: "e8", eventAt: "2026-07-18T20:00:00Z", title: "Beach / Bonfire!! 🔥" }),
      NOW,
    );
    expect(ics!.filename).toMatch(/^[\w-]+\.ics$/);
  });
});
