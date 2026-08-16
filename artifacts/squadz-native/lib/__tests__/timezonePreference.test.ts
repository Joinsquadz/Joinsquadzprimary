import { describe, it, expect } from "vitest";
import {
  resolveOfflineTimezone,
  resolveSyncedTimezone,
  shouldPersistDetected,
} from "@/lib/timezonePreference";

const DEVICE = "America/New_York";
const CHOSEN = "America/Los_Angeles";

describe("resolveSyncedTimezone", () => {
  it("adopts the detected device zone in automatic mode", () => {
    expect(resolveSyncedTimezone({ timezone: CHOSEN, timezoneMode: "automatic" }, DEVICE)).toEqual({
      timezone: DEVICE,
      mode: "automatic",
    });
  });

  it("keeps the saved zone in manual mode even when the device moved", () => {
    expect(resolveSyncedTimezone({ timezone: CHOSEN, timezoneMode: "manual" }, DEVICE)).toEqual({
      timezone: CHOSEN,
      mode: "manual",
    });
  });

  it("treats a missing mode as automatic", () => {
    expect(resolveSyncedTimezone({}, DEVICE)).toEqual({ timezone: DEVICE, mode: "automatic" });
  });

  it("falls back to detection if manual mode has no saved zone", () => {
    expect(resolveSyncedTimezone({ timezone: null, timezoneMode: "manual" }, DEVICE)).toEqual({
      timezone: DEVICE,
      mode: "manual",
    });
  });
});

describe("shouldPersistDetected", () => {
  it("writes back a newly detected zone when travelling in automatic mode", () => {
    expect(shouldPersistDetected({ timezone: CHOSEN, timezoneMode: "automatic" }, DEVICE)).toBe(true);
  });

  it("does not rewrite an unchanged automatic zone", () => {
    expect(shouldPersistDetected({ timezone: DEVICE, timezoneMode: "automatic" }, DEVICE)).toBe(false);
  });

  it("never writes over a manual selection", () => {
    expect(shouldPersistDetected({ timezone: CHOSEN, timezoneMode: "manual" }, DEVICE)).toBe(false);
  });
});

describe("resolveOfflineTimezone", () => {
  it("preserves a manual selection when preferences can't be reached", () => {
    // The regression: an authenticated user who manually picked a zone opens
    // the app with no network. Falling back to the detected device zone would
    // silently revert their choice and shift every event time they read.
    expect(resolveOfflineTimezone({ timezone: CHOSEN, mode: "manual" }, DEVICE)).toEqual({
      timezone: CHOSEN,
      mode: "manual",
    });
  });

  it("tracks the device offline when the cached preference is automatic", () => {
    expect(resolveOfflineTimezone({ timezone: CHOSEN, mode: "automatic" }, DEVICE)).toEqual({
      timezone: DEVICE,
      mode: "automatic",
    });
  });

  it("tracks the device when there is no cache at all", () => {
    expect(resolveOfflineTimezone(null, DEVICE)).toEqual({ timezone: DEVICE, mode: "automatic" });
  });

  it("ignores a manual marker with no zone rather than showing nothing", () => {
    expect(resolveOfflineTimezone({ mode: "manual" }, DEVICE)).toEqual({
      timezone: DEVICE,
      mode: "manual",
    });
  });
});
