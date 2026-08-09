/**
 * Cent-exact money utilities for the mobile app.
 *
 * The canonical implementations live in `lib/cost-math` (used by the
 * api-server via `@workspace/cost-math`). This file re-implements the same
 * functions inline so the mobile bundle stays self-contained — Expo's bundler
 * doesn't need to resolve the workspace package, and there is no separate
 * build step. Any change here must be mirrored in `lib/cost-math/src/index.ts`
 * (and vice versa) to keep client and server in sync.
 */

export const toCents = (amount: number): number => Math.round(amount * 100);
export const fromCents = (cents: number): number => cents / 100;

/**
 * True when `amount` is exactly representable in cents. Compares against the
 * 2-decimal rendering rather than `amount * 100`, because values like 10.05
 * multiply to 1004.9999999999999 in binary floating point.
 */
export const isWholeCent = (amount: number): boolean =>
  Number.isFinite(amount) && Number(amount.toFixed(2)) === amount;

export type BillDetailsInput = {
  baseAmount?: number;
  taxAmount?: number;
  tipAmount?: number;
  /** Percentage expressed as a number 0–1000 (e.g. 20 = 20%). */
  tipPercent?: number;
  feeAmount?: number;
};

/** Returns a cent-exact total. Percentage tips are calculated from base + tax. */
export function calculateBillTotal(details: BillDetailsInput): number {
  const base = toCents(details.baseAmount ?? 0);
  const tax = toCents(details.taxAmount ?? 0);
  const fee = toCents(details.feeAmount ?? 0);
  const tip =
    details.tipPercent !== undefined
      ? Math.round((base + tax) * (details.tipPercent / 100))
      : toCents(details.tipAmount ?? 0);
  return fromCents(base + tax + tip + fee);
}

/** Penny-accurate even split. Extra cents are assigned in participant order. */
export function computeEvenShares(
  total: number,
  participantIds: string[],
): Record<string, string> {
  const shares: Record<string, string> = {};
  const totalCents = toCents(total);
  if (totalCents > 0 && participantIds.length > 0) {
    const each = Math.floor(totalCents / participantIds.length);
    const remainder = totalCents % participantIds.length;
    participantIds.forEach((id, index) => {
      shares[id] = fromCents(each + (index < remainder ? 1 : 0)).toFixed(2);
    });
  }
  return shares;
}

/**
 * Distributes `total` proportionally according to share weights.
 * Weights can be integers (1, 2, 3), percentages (60, 40), or any positive
 * numbers — only their relative ratios matter.
 *
 * Leftover pennies are assigned to participants in descending fractional-part
 * order (ties broken by original insertion order), matching the determinism of
 * `computeEvenShares`. Returns an empty object when the total is ≤ 0 or the
 * total weight is ≤ 0.
 */
export function computeWeightedShares(
  total: number,
  weights: Record<string, number>,
): Record<string, string> {
  const ids = Object.keys(weights);
  const totalWeight = ids.reduce((sum, id) => sum + (weights[id] || 0), 0);
  const totalCents = toCents(total);
  if (totalCents <= 0 || totalWeight <= 0 || ids.length === 0) return {};

  // Raw (fractional) cent allocation per participant.
  const rawCents = ids.map((id) => (weights[id] || 0) / totalWeight * totalCents);
  const flooredCents = rawCents.map((c) => Math.floor(c));
  const remainder = totalCents - flooredCents.reduce((s, c) => s + c, 0);

  // Assign leftover pennies to participants with the largest fractional parts;
  // ties are broken by original order so results are deterministic.
  const order = ids
    .map((_, i) => i)
    .sort((a, b) => (rawCents[b] - flooredCents[b]) - (rawCents[a] - flooredCents[a]) || a - b);

  const bonusCents = new Array(ids.length).fill(0) as number[];
  for (let k = 0; k < remainder; k++) bonusCents[order[k]] = 1;

  const result: Record<string, string> = {};
  ids.forEach((id, i) => {
    result[id] = fromCents(flooredCents[i] + bonusCents[i]).toFixed(2);
  });
  return result;
}

type BillDetails = {
  baseAmount?: number;
  taxAmount?: number;
  tipAmount?: number;
  tipPercent?: number;
  feeAmount?: number;
};

/**
 * Validates that the total amount, per-share amounts, and optional bill
 * breakdown are mutually consistent and whole-cent. Mirrors the server-side
 * check in `lib/cost-math` so the client can surface errors locally before
 * submitting.
 */
export function isValidCostAmounts(
  amount: number,
  shares: Array<{ amount: number }>,
  billDetails?: BillDetails,
): boolean {
  if (!isWholeCent(amount) || amount <= 0) return false;
  if (shares.some((share) => !isWholeCent(share.amount) || share.amount < 0)) return false;
  if (shares.reduce((sum, share) => sum + toCents(share.amount), 0) !== toCents(amount)) return false;
  if (!billDetails) return true;
  const { baseAmount = 0, taxAmount = 0, tipAmount, tipPercent, feeAmount = 0 } = billDetails;
  if (![baseAmount, taxAmount, feeAmount].every((v) => isWholeCent(v) && v >= 0)) return false;
  if (tipAmount !== undefined && (!isWholeCent(tipAmount) || tipAmount < 0)) return false;
  if (tipPercent !== undefined && (!Number.isFinite(tipPercent) || tipPercent < 0 || tipPercent > 1000)) return false;
  if (tipAmount !== undefined && tipPercent !== undefined) return false;
  const tip =
    tipPercent !== undefined
      ? Math.round((toCents(baseAmount) + toCents(taxAmount)) * (tipPercent / 100))
      : toCents(tipAmount ?? 0);
  return toCents(amount) === toCents(baseAmount) + toCents(taxAmount) + tip + toCents(feeAmount);
}
