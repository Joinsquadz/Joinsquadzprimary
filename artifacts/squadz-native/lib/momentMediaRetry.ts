/** A newly uploaded object can take a brief moment to become readable. */
export const MAX_MOMENT_MEDIA_RETRIES = 2;

/**
 * Returns the next cache-busting attempt number, or null when the bounded retry
 * budget has been used. Keeping retries finite avoids a spinner that never ends
 * for genuinely unavailable media.
 */
export function nextMomentMediaRetryAttempt(currentAttempt: number): number | null {
  return currentAttempt < MAX_MOMENT_MEDIA_RETRIES ? currentAttempt + 1 : null;
}

/** Produce a distinct image source for retry attempts without changing the stored path. */
export function momentMediaUrl(path: string, attempt: number, mediaId: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return attempt === 0 ? path : `${path}${separator}moment-retry=${mediaId}-${attempt}`;
}