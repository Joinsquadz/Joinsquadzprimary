import { describe, it, expect } from "vitest";
import {
  toCents,
  fromCents,
  isWholeCent,
  calculateBillTotal,
  computeEvenShares,
  isValidCostAmounts,
} from "../index.js";

// ---------------------------------------------------------------------------
// toCents / fromCents
// ---------------------------------------------------------------------------

describe("toCents", () => {
  it("converts whole dollars", () => {
    expect(toCents(10)).toBe(1000);
  });

  it("converts cents-only amounts", () => {
    expect(toCents(0.05)).toBe(5);
  });

  it("rounds to avoid floating-point drift", () => {
    // 10.05 in binary floating point is slightly below 1005 cents
    expect(toCents(10.05)).toBe(1005);
    expect(toCents(47.11)).toBe(4711);
  });

  it("returns 0 for 0", () => {
    expect(toCents(0)).toBe(0);
  });
});

describe("fromCents", () => {
  it("converts cents back to dollars", () => {
    expect(fromCents(1005)).toBe(10.05);
    expect(fromCents(4711)).toBe(47.11);
  });

  it("handles zero", () => {
    expect(fromCents(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isWholeCent
// ---------------------------------------------------------------------------

describe("isWholeCent", () => {
  it("accepts whole-dollar amounts", () => {
    expect(isWholeCent(10)).toBe(true);
    expect(isWholeCent(0)).toBe(true);
  });

  it("accepts amounts with exactly one decimal place", () => {
    expect(isWholeCent(10.5)).toBe(true);
  });

  it("accepts amounts with exactly two decimal places (the tricky float cases)", () => {
    expect(isWholeCent(10.05)).toBe(true);
    expect(isWholeCent(47.11)).toBe(true);
    expect(isWholeCent(0.01)).toBe(true);
  });

  it("rejects sub-cent amounts", () => {
    expect(isWholeCent(10.005)).toBe(false);
    expect(isWholeCent(0.001)).toBe(false);
  });

  it("rejects non-finite values", () => {
    expect(isWholeCent(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isWholeCent(Number.NEGATIVE_INFINITY)).toBe(false);
    expect(isWholeCent(Number.NaN)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// calculateBillTotal
// ---------------------------------------------------------------------------

describe("calculateBillTotal", () => {
  it("returns 0 for an empty input", () => {
    expect(calculateBillTotal({})).toBe(0);
  });

  it("sums base, tax, flat tip and fee", () => {
    expect(
      calculateBillTotal({ baseAmount: 80, taxAmount: 7.2, tipAmount: 15, feeAmount: 2.5 }),
    ).toBe(104.7);
  });

  it("computes a percentage tip from base + tax", () => {
    // 20% of (80 + 7.20) = 17.44
    expect(calculateBillTotal({ baseAmount: 80, taxAmount: 7.2, tipPercent: 20 })).toBe(104.64);
  });

  it("rounds a percentage tip to the nearest cent", () => {
    // 18% of 33.33 = 5.9994 → rounds to 6 cents = $0.06 → total 39.33
    expect(calculateBillTotal({ baseAmount: 33.33, tipPercent: 18 })).toBe(39.33);
  });

  it("prefers tipPercent when both tip forms are supplied", () => {
    expect(calculateBillTotal({ baseAmount: 100, tipPercent: 10, tipAmount: 50 })).toBe(110);
  });

  it("avoids float drift on repeating decimals", () => {
    expect(calculateBillTotal({ baseAmount: 0.1, taxAmount: 0.2 })).toBe(0.3);
  });

  it("handles the $47.11 regression total", () => {
    // $40 base + $5.11 tax + $2 fee = $47.11
    expect(
      calculateBillTotal({ baseAmount: 40, taxAmount: 5.11, feeAmount: 2 }),
    ).toBe(47.11);
  });

  it("applies a 0% tip without error", () => {
    expect(calculateBillTotal({ baseAmount: 50, tipPercent: 0 })).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// computeEvenShares
// ---------------------------------------------------------------------------

const sumShareCents = (shares: Record<string, string>): number =>
  Object.values(shares).reduce((total, v) => total + toCents(parseFloat(v)), 0);

describe("computeEvenShares", () => {
  it("splits evenly when the total divides cleanly", () => {
    expect(computeEvenShares(30, ["a", "b", "c"])).toEqual({
      a: "10.00",
      b: "10.00",
      c: "10.00",
    });
  });

  it("assigns extra pennies in participant order", () => {
    expect(computeEvenShares(100, ["a", "b", "c"])).toEqual({
      a: "33.34",
      b: "33.33",
      c: "33.33",
    });
  });

  it("gives every leftover cent out for a minimal case", () => {
    expect(computeEvenShares(0.02, ["a", "b", "c"])).toEqual({
      a: "0.01",
      b: "0.01",
      c: "0.00",
    });
  });

  it("reconciles exactly across many totals and party sizes (incl. $10.05 and $47.11)", () => {
    const totals = [0.01, 0.07, 10, 10.05, 19.99, 47.11, 100, 104.7, 1234.56];
    for (const total of totals) {
      for (let people = 1; people <= 9; people++) {
        const ids = Array.from({ length: people }, (_, i) => `u${i}`);
        const shares = computeEvenShares(total, ids);
        expect(sumShareCents(shares)).toBe(toCents(total));
      }
    }
  });

  it("never differs by more than one cent between participants", () => {
    const shares = computeEvenShares(100, ["a", "b", "c", "d", "e", "f", "g"]);
    const cents = Object.values(shares).map((v) => toCents(parseFloat(v)));
    expect(Math.max(...cents) - Math.min(...cents)).toBeLessThanOrEqual(1);
  });

  it("returns empty shares for a zero total", () => {
    expect(computeEvenShares(0, ["a", "b"])).toEqual({});
  });

  it("returns empty shares for an empty participant list", () => {
    expect(computeEvenShares(50, [])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// isValidCostAmounts
// ---------------------------------------------------------------------------

describe("isValidCostAmounts", () => {
  it("accepts a valid amount + matching shares", () => {
    expect(
      isValidCostAmounts(30, [{ amount: 10 }, { amount: 10 }, { amount: 10 }]),
    ).toBe(true);
  });

  it("accepts the tricky $10.05 split", () => {
    // 3 people: 3.35 + 3.35 + 3.35
    expect(
      isValidCostAmounts(10.05, [{ amount: 3.35 }, { amount: 3.35 }, { amount: 3.35 }]),
    ).toBe(true);
  });

  it("accepts the tricky $47.11 split", () => {
    // 3 people: 15.71 + 15.70 + 15.70
    expect(
      isValidCostAmounts(47.11, [{ amount: 15.71 }, { amount: 15.70 }, { amount: 15.70 }]),
    ).toBe(true);
  });

  it("rejects when shares don't add up to the total", () => {
    expect(
      isValidCostAmounts(30, [{ amount: 10 }, { amount: 10 }, { amount: 9.99 }]),
    ).toBe(false);
  });

  it("rejects a zero total", () => {
    expect(isValidCostAmounts(0, [{ amount: 0 }])).toBe(false);
  });

  it("rejects a negative total", () => {
    expect(isValidCostAmounts(-5, [{ amount: -5 }])).toBe(false);
  });

  it("rejects a sub-cent total", () => {
    expect(isValidCostAmounts(10.005, [{ amount: 10.005 }])).toBe(false);
  });

  it("rejects a negative share amount", () => {
    expect(isValidCostAmounts(10, [{ amount: 12 }, { amount: -2 }])).toBe(false);
  });

  it("rejects a sub-cent share amount", () => {
    expect(isValidCostAmounts(10, [{ amount: 5.001 }, { amount: 4.999 }])).toBe(false);
  });

  it("accepts an empty shares array when total and shares both zero — but total must be positive, so rejects", () => {
    // The only way shares sum to 0 in cents is if total is also 0, which is invalid
    expect(isValidCostAmounts(5, [])).toBe(false);
  });

  // ----- with billDetails -----

  it("accepts a valid flat-tip bill breakdown", () => {
    // base 80 + tax 7.20 + tip 15 + fee 2.50 = 104.70
    expect(
      isValidCostAmounts(
        104.7,
        [{ amount: 52.35 }, { amount: 52.35 }],
        { baseAmount: 80, taxAmount: 7.2, tipAmount: 15, feeAmount: 2.5 },
      ),
    ).toBe(true);
  });

  it("accepts a valid percent-tip bill breakdown", () => {
    // base 80 + tax 7.20 → 20% tip = 17.44 → total 104.64
    expect(
      isValidCostAmounts(
        104.64,
        [{ amount: 52.32 }, { amount: 52.32 }],
        { baseAmount: 80, taxAmount: 7.2, tipPercent: 20 },
      ),
    ).toBe(true);
  });

  it("rejects when bill details don't reconcile with the total", () => {
    // base 80 + tip 10 = 90, but we claim 95
    expect(
      isValidCostAmounts(95, [{ amount: 95 }], { baseAmount: 80, tipAmount: 10 }),
    ).toBe(false);
  });

  it("rejects when both tipAmount and tipPercent are provided", () => {
    expect(
      isValidCostAmounts(
        110,
        [{ amount: 110 }],
        { baseAmount: 100, tipAmount: 10, tipPercent: 10 },
      ),
    ).toBe(false);
  });

  it("rejects a negative tipPercent", () => {
    expect(
      isValidCostAmounts(90, [{ amount: 90 }], { baseAmount: 100, tipPercent: -10 }),
    ).toBe(false);
  });

  it("rejects a tipPercent above 1000", () => {
    expect(
      isValidCostAmounts(90, [{ amount: 90 }], { baseAmount: 100, tipPercent: 1001 }),
    ).toBe(false);
  });

  it("rejects a negative baseAmount in billDetails", () => {
    expect(
      isValidCostAmounts(10, [{ amount: 10 }], { baseAmount: -10, tipAmount: 20 }),
    ).toBe(false);
  });

  it("rejects a sub-cent feeAmount", () => {
    expect(
      isValidCostAmounts(10.005, [{ amount: 10.005 }], { baseAmount: 10, feeAmount: 0.005 }),
    ).toBe(false);
  });
});
