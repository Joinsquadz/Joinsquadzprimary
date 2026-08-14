/**
 * Returns the next index to browse in an ordered gallery, or null at either
 * boundary. Keeping this tiny rule separate makes all vault contexts use the
 * exact same boundary behavior.
 */
export function galleryNeighborIndex(
  currentIndex: number,
  direction: "previous" | "next",
  length: number,
): number | null {
  if (currentIndex < 0 || currentIndex >= length) return null;
  const target = direction === "previous" ? currentIndex - 1 : currentIndex + 1;
  return target >= 0 && target < length ? target : null;
}