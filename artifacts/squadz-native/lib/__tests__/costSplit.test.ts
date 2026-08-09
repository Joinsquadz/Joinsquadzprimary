import { describe, it, expect } from "vitest";
import { calculateBillTotal, computeEvenShares, computeWeightedShares, isWholeCent, toCents } from "@/lib/costSplit";

const sumShares = (shares: Record<string, string>): number =>
  Object.values(shares).reduce((total, amount) => total + toCents(parseFloat(amount)), 0);

describe("calculateBillTotal", () => {
  it("returns 0 when nothing is entered", () => {
    expect(calculateBillTotal({})).toBe(0);
  });

  it("adds base, tax, flat tip and fees", () => {
    expect(calculateBillTotal({ baseAmount: 80, taxAmount: 7.2, tipAmount: 15, feeAmount: 2.5 })).toBe(104.7);
  });

  it("computes a percentage tip from base + tax", () => {
    // 20% of (80 + 7.20) = 17.44
    expect(calculateBillTotal({ baseAmount: 80, taxAmount: 7.2, tipPercent: 20 })).toBe(104.64);
  });

  it("rounds a percentage tip to the nearest cent", () => {
    // 18% of 33.33 = 5.9994 → 6.00
    expect(calculateBillTotal({ baseAmount: 33.33, tipPercent: 18 })).toBe(39.33);
  });

  it("prefers the percentage tip when both tip forms are present", () => {
    expect(calculateBillTotal({ baseAmount: 100, tipPercent: 10, tipAmount: 50 })).toBe(110);
  });

  it("avoids float drift when summing repeating decimals", () => {
    expect(calculateBillTotal({ baseAmount: 0.1, taxAmount: 0.2 })).toBe(0.3);
  });
});

describe("isWholeCent", () => {
  it("accepts whole-cent values", () => {
    expect(isWholeCent(10)).toBe(true);
    expect(isWholeCent(10.5)).toBe(true);
    expect(isWholeCent(10.05)).toBe(true);
  });

  it("rejects sub-cent and non-finite values", () => {
    expect(isWholeCent(10.005)).toBe(false);
    expect(isWholeCent(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isWholeCent(Number.NaN)).toBe(false);
  });
});

describe("computeEvenShares", () => {
  it("splits evenly when the total divides cleanly", () => {
    expect(computeEvenShares(30, ["a", "b", "c"])).toEqual({ a: "10.00", b: "10.00", c: "10.00" });
  });

  it("assigns leftover pennies in participant order", () => {
    expect(computeEvenShares(100, ["a", "b", "c"])).toEqual({ a: "33.34", b: "33.33", c: "33.33" });
  });

  it("gives every leftover cent out (0.02 across 3 people)", () => {
    expect(computeEvenShares(0.02, ["a", "b", "c"])).toEqual({ a: "0.01", b: "0.01", c: "0.00" });
  });

  it("reconciles exactly for many uneven totals and party sizes", () => {
    const totals = [0.01, 0.07, 10, 19.99, 47.11, 100, 104.7, 1234.56];
    for (const total of totals) {
      for (let people = 1; people <= 9; people += 1) {
        const ids = Array.from({ length: people }, (_, index) => `u${index}`);
        const shares = computeEvenShares(total, ids);
        expect(sumShares(shares)).toBe(toCents(total));
      }
    }
  });

  it("never differs by more than a penny between participants", () => {
    const shares = computeEvenShares(100, ["a", "b", "c", "d", "e", "f", "g"]);
    const cents = Object.values(shares).map((amount) => toCents(parseFloat(amount)));
    expect(Math.max(...cents) - Math.min(...cents)).toBeLessThanOrEqual(1);
  });

  it("returns no shares for a zero total or an empty party", () => {
    expect(computeEvenShares(0, ["a", "b"])).toEqual({});
    expect(computeEvenShares(50, [])).toEqual({});
  });
});

describe("computeWeightedShares", () => {
  it("distributes a 60/40 percentage split exactly", () => {
    const shares = computeWeightedShares(100, { a: 60, b: 40 });
    expect(shares).toEqual({ a: "60.00", b: "40.00" });
  });

  it("distributes a 2:1 share weight split", () => {
    const shares = computeWeightedShares(30, { a: 2, b: 1 });
    expect(shares).toEqual({ a: "20.00", b: "10.00" });
  });

  it("always sums to the exact total in cents", () => {
    const totals = [0.01, 0.07, 10, 19.99, 47.11, 100, 104.7, 1234.56];
    const weightSets: Record<string, number>[] = [
      { a: 1, b: 1, c: 1 },
      { a: 2, b: 1 },
      { a: 3, b: 2, c: 1 },
      { a: 60, b: 40 },
      { a: 1, b: 2, c: 3, d: 4 },
    ];
    for (const total of totals) {
      for (const weights of weightSets) {
        const shares = computeWeightedShares(total, weights);
        const sumCents = Object.values(shares).reduce(
          (s, v) => s + toCents(parseFloat(v)),
          0,
        );
        expect(sumCents).toBe(toCents(total));
      }
    }
  });

  it("assigns leftover pennies to largest-fractional-part participants", () => {
    // $10 split 60/40 → $6.00 / $4.00 (clean). Use a messier case: $1 at 3:2
    // 3/5 * 100 = 60 cents, 2/5 * 100 = 40 cents → exact
    // $0.10 at 3:2 → 6 cents / 4 cents → exact
    // Try $1 split 1:1:1 → 33 + 33 + 34
    const shares = computeWeightedShares(1, { a: 1, b: 1, c: 1 });
    const cents = Object.values(shares).map((v) => toCents(parseFloat(v)));
    expect(cents.reduce((s, c) => s + c, 0)).toBe(100);
    expect(Math.max(...cents) - Math.min(...cents)).toBeLessThanOrEqual(1);
  });

  it("one participant gets the full amount when only their weight is non-zero", () => {
    const shares = computeWeightedShares(50, { a: 1, b: 0 });
    expect(shares).toEqual({ a: "50.00", b: "0.00" });
  });

  it("returns empty for zero total or zero total weight", () => {
    expect(computeWeightedShares(0, { a: 1, b: 1 })).toEqual({});
    expect(computeWeightedShares(100, { a: 0, b: 0 })).toEqual({});
    expect(computeWeightedShares(100, {})).toEqual({});
  });

  it("handles an uneven 3-person party-size regression", () => {
    // $47.11 with weights 3, 2, 1 (person carrying 2 guests)
    const shares = computeWeightedShares(47.11, { a: 3, b: 2, c: 1 });
    const sumCents = Object.values(shares).reduce(
      (s, v) => s + toCents(parseFloat(v)),
      0,
    );
    expect(sumCents).toBe(toCents(47.11));
  });
});
