import { describe, it, expect } from "vitest";
import { MIN_SIGNUP_AGE, ageOn, isValidDobString, meetsMinAge, toDobString } from "@/lib/age";

/**
 * Client-side mirror of the server's 13+ rule. These are the checks the signup
 * screen runs before it will send a registration request, so a regression here
 * shows up as an under-13 signup being allowed to hit the API (the server still
 * rejects it, but the UX message is lost).
 */
describe("isValidDobString", () => {
  it("accepts a well-formed calendar date", () => {
    expect(isValidDobString("1994-02-28")).toBe(true);
    expect(isValidDobString("2004-02-29")).toBe(true); // leap year
  });

  it("rejects an empty or missing date of birth", () => {
    expect(isValidDobString("")).toBe(false);
    expect(isValidDobString("   ")).toBe(false);
  });

  it("rejects wrong formats", () => {
    expect(isValidDobString("not-a-date")).toBe(false);
    expect(isValidDobString("12/03/1994")).toBe(false);
    expect(isValidDobString("1994-2-3")).toBe(false);
    expect(isValidDobString("1994-02-28T00:00:00Z")).toBe(false);
  });

  it("rejects impossible calendar dates", () => {
    expect(isValidDobString("2000-02-30")).toBe(false);
    expect(isValidDobString("2001-02-29")).toBe(false); // not a leap year
    expect(isValidDobString("2000-13-01")).toBe(false);
    expect(isValidDobString("2000-00-10")).toBe(false);
  });
});

describe("ageOn", () => {
  const today = new Date(2026, 7, 9); // 2026-08-09

  it("counts completed years", () => {
    expect(ageOn("2000-08-09", today)).toBe(26);
    expect(ageOn("2000-08-08", today)).toBe(26);
  });

  it("does not count a birthday that hasn't happened yet this year", () => {
    expect(ageOn("2000-08-10", today)).toBe(25);
    expect(ageOn("2000-12-31", today)).toBe(25);
  });

  it("returns null for an invalid date so callers can say 'invalid', not 'too young'", () => {
    expect(ageOn("nope", today)).toBeNull();
    expect(ageOn("", today)).toBeNull();
  });

  it("returns null for a future date of birth", () => {
    expect(ageOn("2030-01-01", today)).toBeNull();
  });
});

describe("meetsMinAge", () => {
  const today = new Date(2026, 7, 9);

  it("allows someone whose 13th birthday is today", () => {
    expect(meetsMinAge("2013-08-09", today)).toBe(true);
  });

  it("blocks someone who turns 13 tomorrow", () => {
    expect(meetsMinAge("2013-08-10", today)).toBe(false);
  });

  it("blocks a clearly under-13 date of birth", () => {
    expect(meetsMinAge("2020-01-01", today)).toBe(false);
  });

  it("blocks an invalid or missing date of birth rather than defaulting to allowed", () => {
    expect(meetsMinAge("", today)).toBe(false);
    expect(meetsMinAge("garbage", today)).toBe(false);
    expect(meetsMinAge("2030-01-01", today)).toBe(false);
  });

  it("uses the same minimum the server enforces", () => {
    expect(MIN_SIGNUP_AGE).toBe(13);
  });
});

describe("toDobString", () => {
  it("zero-pads month and day so the server regex matches", () => {
    expect(toDobString(new Date(2001, 0, 5))).toBe("2001-01-05");
    expect(toDobString(new Date(1999, 11, 31))).toBe("1999-12-31");
  });

  it("round-trips through the validator", () => {
    expect(isValidDobString(toDobString(new Date(2004, 1, 29)))).toBe(true);
  });
});
