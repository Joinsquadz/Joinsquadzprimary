import { describe, it, expect } from "vitest";
import { wallClockToInstant, deviceWallClockToZoneIso, instantToZoneWallClockDate } from "../timezoneFormat";

describe("wallClockToInstant", () => {
  it("interprets a wall clock in a fixed-offset zone (winter Eastern)", () => {
    const d = wallClockToInstant({ year: 2026, month: 1, day: 10, hour: 18, minute: 0 }, "America/New_York");
    expect(d?.toISOString()).toBe("2026-01-10T23:00:00.000Z"); // EST = UTC-5
  });

  it("interprets a wall clock in DST (summer Pacific)", () => {
    const d = wallClockToInstant({ year: 2026, month: 7, day: 4, hour: 18, minute: 0 }, "America/Los_Angeles");
    expect(d?.toISOString()).toBe("2026-07-05T01:00:00.000Z"); // PDT = UTC-7
  });

  it("handles UTC exactly", () => {
    const d = wallClockToInstant({ year: 2026, month: 3, day: 1, hour: 12, minute: 30 }, "UTC");
    expect(d?.toISOString()).toBe("2026-03-01T12:30:00.000Z");
  });

  it("handles midnight without the '24' hour quirk", () => {
    const d = wallClockToInstant({ year: 2026, month: 6, day: 15, hour: 0, minute: 0 }, "America/Chicago");
    expect(d?.toISOString()).toBe("2026-06-15T05:00:00.000Z"); // CDT = UTC-5
  });

  it("handles zones ahead of UTC", () => {
    const d = wallClockToInstant({ year: 2026, month: 6, day: 15, hour: 9, minute: 0 }, "Asia/Tokyo");
    expect(d?.toISOString()).toBe("2026-06-15T00:00:00.000Z"); // JST = UTC+9
  });

  it("resolves an ambiguous fall-back wall clock to a valid instant", () => {
    // 2026-11-01 01:30 happens twice in America/New_York; either instant is
    // acceptable — it must be one of them, not NaN.
    const d = wallClockToInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, "America/New_York");
    expect(d).not.toBeNull();
    expect([
      "2026-11-01T05:30:00.000Z", // EDT reading
      "2026-11-01T06:30:00.000Z", // EST reading
    ]).toContain(d!.toISOString());
  });

  it("returns null for an unusable zone id", () => {
    expect(wallClockToInstant({ year: 2026, month: 1, day: 1, hour: 0, minute: 0 }, "Not/AZone")).toBeNull();
  });
});

describe("deviceWallClockToZoneIso", () => {
  it("matches toISOString when the zone equals the device zone", () => {
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const d = new Date(2026, 5, 7, 18, 0, 0, 0); // device-local June 7, 6 PM
    expect(deviceWallClockToZoneIso(d, deviceZone)).toBe(d.toISOString());
  });

  it("keeps the picked wall clock when reinterpreting into another zone", () => {
    // Device-local 6:00 PM must become 6:00 PM *Pacific* regardless of the
    // device zone the test runs in.
    const d = new Date(2026, 5, 7, 18, 0, 0, 0);
    const iso = deviceWallClockToZoneIso(d, "America/Los_Angeles");
    expect(iso).toBe("2026-06-08T01:00:00.000Z"); // 6 PM PDT
  });

  it("falls back to toISOString on an unusable zone", () => {
    const d = new Date(2026, 5, 7, 18, 0, 0, 0);
    expect(deviceWallClockToZoneIso(d, "Not/AZone")).toBe(d.toISOString());
  });
});

describe("instantToZoneWallClockDate (picker surrogate for the edit flow)", () => {
  it("renders an instant's chosen-zone wall clock into device-local fields", () => {
    // 2026-06-08T01:00Z is 6:00 PM June 7 in LA — the surrogate must carry
    // those fields regardless of the device zone.
    const surrogate = instantToZoneWallClockDate(new Date("2026-06-08T01:00:00.000Z"), "America/Los_Angeles");
    expect([surrogate.getFullYear(), surrogate.getMonth() + 1, surrogate.getDate()]).toEqual([2026, 6, 7]);
    expect([surrogate.getHours(), surrogate.getMinutes()]).toEqual([18, 0]);
  });

  it("round-trips: existing instant → surrogate → unchanged instant", () => {
    // An edit that opens the picker and confirms without touching it must
    // save the exact same end time.
    const original = new Date("2026-01-10T23:30:00.000Z");
    const surrogate = instantToZoneWallClockDate(original, "America/New_York");
    expect(deviceWallClockToZoneIso(surrogate, "America/New_York")).toBe(original.toISOString());
  });

  it("cross-zone edit: changing the surrogate's wall clock shifts the instant in the chosen zone", () => {
    // Existing end: 8:00 PM Pacific. User (device in another zone) bumps the
    // displayed 8:00 PM to 9:00 PM — the stored instant must move exactly 1h.
    const original = new Date("2026-06-08T03:00:00.000Z"); // 8 PM PDT Jun 7
    const surrogate = instantToZoneWallClockDate(original, "America/Los_Angeles");
    expect(surrogate.getHours()).toBe(20);
    const edited = new Date(surrogate);
    edited.setHours(21, 0);
    expect(deviceWallClockToZoneIso(edited, "America/Los_Angeles")).toBe("2026-06-08T04:00:00.000Z");
  });

  it("is the identity (device-local fields) when zone equals the device zone", () => {
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const instant = new Date(2026, 2, 3, 14, 45, 0, 0);
    const surrogate = instantToZoneWallClockDate(instant, deviceZone);
    expect(surrogate.getTime()).toBe(instant.getTime());
  });

  it("falls back to the instant itself on an unusable zone", () => {
    const instant = new Date("2026-06-08T01:00:00.000Z");
    expect(instantToZoneWallClockDate(instant, "Not/AZone").getTime()).toBe(instant.getTime());
  });
});
