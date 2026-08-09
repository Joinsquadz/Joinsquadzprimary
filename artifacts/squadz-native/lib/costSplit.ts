
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
