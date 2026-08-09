export type BillDetailsInput = {
  baseAmount?: number;
  taxAmount?: number;
  tipAmount?: number;
  tipPercent?: number;
  feeAmount?: number;
};

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
  const tip = details.tipPercent !== undefined
    ? Math.round((base + tax) * details.tipPercent / 100)
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
