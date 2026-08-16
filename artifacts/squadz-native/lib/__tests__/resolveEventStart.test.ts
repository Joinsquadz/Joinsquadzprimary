import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveEventStart } from "@/lib/calendar";

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
