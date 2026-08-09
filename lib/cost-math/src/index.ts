/**
 * Shared cent-exact money arithmetic used by both the API server and the
 * mobile app. A single source of truth prevents the client and server from
 * diverging on rounding rules, which would cause the server to reject totals
 * the app itself calculated.
 */

export type BillDetailsInput = {
  baseAmount?: number;
  taxAmount?: number;
  tipAmount?: number;
  /** Percentage expressed as a number 0–1000 (e.g. 20 = 20%). */
  tipPercent?: number;
  feeAmount?: number;
};

/** Error message used in Zod refine calls for whole-cent validation. */
export const WHOLE_CENT_MESSAGE = "Money amounts must use no more than two decimal places";

export const toCents = (amount: number): number => Math.round(amount * 100);
export const fromCents = (cents: number): number => cents / 100;

/**
 * True when `amount` is exactly representable in cents. Compares against the
 * 2-decimal rendering rather than `amount * 100`, because values like 10.05
 * multiply to 1004.9999999999999 in binary floating point.
 */
export const isWholeCent = (amount: number): boolean =>
  Number.isFinite(amount) && Number(amount.toFixed(2)) === amount;

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

type BillDetails = {
  baseAmount?: number;
  taxAmount?: number;
  tipAmount?: number;
  tipPercent?: number;
  feeAmount?: number;
};

/**
 * Validates that the total amount, per-share amounts, and optional bill
 * breakdown are mutually consistent and whole-cent. The server runs this on
 * every cost create/update; the mobile client can run the same check before
 * submitting so the user sees the error locally rather than getting a 422.
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
