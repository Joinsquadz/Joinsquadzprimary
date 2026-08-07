/**
 * DB-backed debounce for push notifications.
 *
 * Replaces the per-process in-memory Map with a shared atomic check backed by
 * the rate_limits table so debounce state is consistent across multiple server
 * instances (horizontal autoscale). Uses the same atomic upsert already
 * powering the API rate limiter.
 *
 * Semantics: identical to before — a send is suppressed when the same
 * (type, actor, recipient) triple fired within `windowMs`. The key is prefixed
 * `notif_debounce:` to avoid collisions with rate-limit keys.
 *
 * The function is now async (was synchronous) because it hits the DB.
 * All callers are already in async functions so the change is additive.
 * Degrades gracefully on DB error: always returns true so notifications fire
 * rather than being silently dropped.
 */
import { isKeyRateLimited } from './rateLimiter';

/**
 * Returns `true` if the notification should fire (cooldown has elapsed or this
 * is the first occurrence) and records the current timestamp in the DB.
 * Returns `false` if the cooldown is still active — the caller should skip.
 *
 * @param actor     The user triggering the notification (e.g. commenter userId).
 * @param recipient The user receiving the notification.
 * @param type      A stable string identifying the notification type
 *                  (e.g. "vault_comment", "feed_comment", "moment_reaction").
 * @param windowMs  Cooldown window in milliseconds.
 */
export async function shouldSendNotification(
  actor: string,
  recipient: string,
  type: string,
  windowMs: number,
): Promise<boolean> {
  const key = `notif_debounce:${type}:${actor}:${recipient}`;
  // max=1 per window: the rate-limit upsert fires the notification on window
  // reset (count becomes 1 ≤ max=1) and suppresses repeated calls within the
  // same window (count becomes 2 > max=1). Matches the previous in-memory
  // semantics exactly, but now shared across all server instances.
  const { limited } = await isKeyRateLimited(key, 1, windowMs);
  return !limited;
}
