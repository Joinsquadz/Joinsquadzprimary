import { describe, it, expect } from "vitest";
import { MIN_SIGNUP_AGE, isValidBirthYear, meetsMinAge } from "@/lib/age";

/**
 * Client-side mirror of the server's 13+ rule. These checks give signup users
 * immediate feedback; the server remains the enforcement point.
 */
describe("isValidBirthYear", () => {
  const today = new Date(2026, 7, 9);

  it("accepts plausible four-digit years", () => {
    expect(isValidBirthYear("1994", today)).toBe(true);
    expect(isValidBirthYear("2026", today)).toBe(true);
  });

  it("rejects blank and malformed years", () => {
    expect(isValidBirthYear("", today)).toBe(false);
    expect(isValidBirthYear("   ", today)).toBe(false);
    expect(isValidBirthYear("not-a-year", today)).toBe(false);
    expect(isValidBirthYear("199", today)).toBe(false);
    expect(isValidBirthYear("19940", today)).toBe(false);
  });

  it("rejects years outside the plausible range", () => {
    expect(isValidBirthYear("1899", today)).toBe(false);
    expect(isValidBirthYear("2027", today)).toBe(false);
  });
});

describe("meetsMinAge", () => {
  const today = new Date(2026, 7, 9);

  it("allows the newest eligible birth year", () => {
    expect(meetsMinAge("2013", today)).toBe(true);
  });

  it("blocks a clearly under-13 birth year", () => {
    expect(meetsMinAge("2020", today)).toBe(false);
  });

  it("blocks an invalid or missing birth year rather than defaulting to allowed", () => {
    expect(meetsMinAge("", today)).toBe(false);
    expect(meetsMinAge("garbage", today)).toBe(false);
    expect(meetsMinAge("2030", today)).toBe(false);
  });

  it("uses the same minimum the server enforces", () => {
    expect(MIN_SIGNUP_AGE).toBe(13);
  });
});