import { describe, it, expect, afterEach, vi } from "vitest";
import {
  isEventPast,
  resolveEventCompletion,
  resolveEventStart,
  resolvePlanCompletion,
  sortPastPlansNewestFirst,
} from "@/lib/calendar";

/**
 * resolveEventStart backs everything that does *time math* on an event:
 * the detail countdown, past/upcoming checks, and RSVP reminder scheduling.
 *
 * The bug it exists to prevent: reading the creator's year-less wall-clock text
 * ("Wed, Jul 15 · 6:00 PM") as the *device's* local time. For a viewer in
 * another zone that resolves to a different absolute moment — a countdown that
 * is hours off and an RSVP nudge scheduled for the wrong day.
 */

// 6:00 PM Jul 15 in Los Angeles === 10:00 AM Jul 16 in Tokyo.
const INSTANT = "2026-07-16T01:00:00.000Z";
const CREATOR_TEXT = "Wed, Jul 15 · 6:00 PM";

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveEventStart", () => {
  it("returns the absolute instant, identically for every viewer", () => {
    const start = resolveEventStart({ date: CREATOR_TEXT, eventAt: INSTANT });
    expect(start?.toISOString()).toBe(INSTANT);
  });

  it("ignores the creator's wall-clock text when an instant exists", () => {
    // The text says 6:00 PM. A viewer whose device is in Tokyo must still get
    // the true moment (10:00 AM Tokyo), not 6:00 PM Tokyo — a 8h error that
    // would show the wrong countdown and fire a reminder on the wrong day.
    const start = resolveEventStart({ date: CREATOR_TEXT, eventAt: INSTANT });
    expect(start?.getTime()).toBe(Date.parse(INSTANT));
    expect(start?.getTime()).not.toBe(Date.parse("2026-07-15T18:00:00Z"));
  });

  it("prefers startAt over eventAt", () => {
    const start = resolveEventStart({
      date: CREATOR_TEXT,
      eventAt: INSTANT,
      startAt: "2026-07-16T03:00:00.000Z",
    });
    expect(start?.toISOString()).toBe("2026-07-16T03:00:00.000Z");
  });

  it("skips an unparseable instant rather than returning Invalid Date", () => {
    // An Invalid Date silently poisons every comparison downstream (a past
    // event stops reading as past), so fall through to the legacy text.
    const start = resolveEventStart({ date: CREATOR_TEXT, eventAt: "nonsense" });
    expect(start).not.toBeNull();
    expect(Number.isNaN(start!.getTime())).toBe(false);
  });

  it("falls back to the stored text for legacy events with no instant", () => {
    vi.useFakeTimers({ now: new Date("2026-07-01T12:00:00Z") });
    const start = resolveEventStart({ date: "Wed, Jul 15 · 6:00 PM" });
    // Legacy path: device-local, which is all the old data supports.
    expect(start).not.toBeNull();
    expect(start!.getMonth()).toBe(6);
    expect(start!.getDate()).toBe(15);
    expect(start!.getHours()).toBe(18);
  });

  it("returns null when there is nothing to resolve", () => {
    expect(resolveEventStart(null)).toBeNull();
    expect(resolveEventStart(undefined)).toBeNull();
    expect(resolveEventStart({ date: "TBD" })).toBeNull();
    expect(resolveEventStart({ date: "", eventAt: null, startAt: null })).toBeNull();
  });

  it("decides past-vs-upcoming on the instant, not the creator's text", () => {
    // "now" sits between the two readings of the same event: the event is over
    // in absolute terms, but the year-less text parsed as device-local time
    // would still look upcoming to a viewer east of the creator.
    vi.useFakeTimers({ now: new Date("2026-07-16T05:00:00Z") });
    const start = resolveEventStart({ date: CREATOR_TEXT, eventAt: INSTANT });
    expect(start!.getTime() < Date.now()).toBe(true);
  });
});

describe("plain event completion", () => {
  const event = {
    eventAt: "2026-07-16T01:00:00.000Z",
    endAt: "2026-07-16T03:00:00.000Z",
  };

  it("keeps a started event active until its configured end", () => {
    expect(resolveEventCompletion(event)?.toISOString()).toBe(event.endAt);
    expect(isEventPast(event, new Date("2026-07-16T02:00:00.000Z"))).toBe(false);
  });

  it("marks the event past after its configured end", () => {
    expect(isEventPast(event, new Date("2026-07-16T03:00:00.001Z"))).toBe(true);
  });

  it("falls back to the start when the end is missing or invalid", () => {
    const now = new Date("2026-07-16T02:00:00.000Z");
    expect(isEventPast({ eventAt: event.eventAt }, now)).toBe(true);
    expect(isEventPast({ eventAt: event.eventAt, endAt: "invalid" }, now)).toBe(true);
  });
});

describe("past plan archive ordering", () => {
  it("puts the most recently completed plan first, using event and trip end times", () => {
    const alaskaCruise = {
      id: "alaska",
      type: "trip" as const,
      date: "Jul 16 – 23, 2026",
      startAt: "2026-07-16T16:00:00.000Z",
      endAt: "2026-07-24T01:00:00.000Z",
    };
    const happyHour = {
      id: "happy-hour",
      type: "event" as const,
      date: "Sun, Aug 16 · 6:00 PM",
      eventAt: "2026-08-17T01:00:00.000Z",
      endAt: "2026-08-17T03:00:00.000Z",
    };
    const lateStarter = {
      id: "late-starter",
      type: "event" as const,
      eventAt: "2026-08-17T02:00:00.000Z",
      endAt: "2026-08-17T02:30:00.000Z",
    };

    expect(resolvePlanCompletion(alaskaCruise)?.toISOString()).toBe(alaskaCruise.endAt);
    expect(resolvePlanCompletion(happyHour)?.toISOString()).toBe(happyHour.endAt);
    expect(sortPastPlansNewestFirst([alaskaCruise, lateStarter, happyHour]).map((plan) => plan.id)).toEqual([
      "happy-hour",
      "late-starter",
      "alaska",
    ]);
  });

  it("keeps trip completion resolution unchanged", () => {
    const trip = {
      type: "trip" as const,
      startAt: "2026-08-10T16:00:00.000Z",
      endAt: "2026-08-12T01:00:00.000Z",
    };
    expect(resolvePlanCompletion(trip)?.toISOString()).toBe(trip.endAt);
  });

  it("keeps undated legacy records behind timestamped plans without reshuffling them", () => {
    const ordered = sortPastPlansNewestFirst([
      { id: "legacy-one", type: "event" as const, date: "TBD" },
      { id: "recent", type: "event" as const, date: "Fri, Aug 21", eventAt: "2026-08-21T20:00:00.000Z" },
      { id: "legacy-two", type: "trip" as const, date: "Dates TBD" },
    ]);

    expect(ordered.map((plan) => plan.id)).toEqual(["recent", "legacy-one", "legacy-two"]);
  });
});
