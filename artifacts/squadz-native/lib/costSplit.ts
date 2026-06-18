/**
 * Penny-accurate even split of `total` across `participantIds`.
 *
 * Every participant but the last gets `floor(total / n)` to the cent; the last
 * participant absorbs the rounding remainder so the shares always sum exactly to
 * `total`. Returns a map of participant id → fixed-2 string (e.g. "12.34").
 *
 * Single source of truth for even-split math shared by the event and trip
 * cost-splitting UIs.
 */
export function computeEvenShares(
  total: number,
  participantIds: string[],
): Record<string, string> {
  const shares: Record<string, string> = {};
  if (total > 0 && participantIds.length > 0) {
    const per = Math.floor((total / participantIds.length) * 100) / 100;
    let running = 0;
    participantIds.forEach((id, i) => {
      if (i === participantIds.length - 1) {
        shares[id] = (Math.round((total - running) * 100) / 100).toFixed(2);
      } else {
        shares[id] = per.toFixed(2);
        running += per;
      }
    });
  }
  return shares;
}
