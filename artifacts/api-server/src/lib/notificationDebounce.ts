/**
 * Lightweight in-memory debounce for push notifications.
 *
 * Keyed by `${type}:${actor}:${recipient}` — a send is suppressed when
 * the same (type, actor, recipient) triple fired within `windowMs`.
 *
 * Intentionally in-memory: the windows involved (2 min) are short enough
 * that a server restart simply resets them, which is acceptable.
 *
 * Entries are pruned lazily on a 10-minute interval to prevent unbounded growth.
 */

const debounceMap = new Map<string, number>();
let lastPrune = Date.now();
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

function maybePrune(windowMs: number): void {
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [key, ts] of debounceMap) {
    if (now - ts >= windowMs) debounceMap.delete(key);
  }
}

/**
 * Returns `true` if the notification should fire (cooldown has elapsed or this
 * is the first occurrence) and records the current timestamp.
 * Returns `false` if the cooldown is still active — the caller should skip the send.
 *
 * @param actor     The user triggering the notification (e.g. commenter userId).
 * @param recipient The user receiving the notification.
 * @param type      A stable string identifying the notification type
 *                  (e.g. "vault_comment", "feed_comment", "moment_reaction").
 * @param windowMs  Cooldown window in milliseconds.
 */
export function shouldSendNotification(
  actor: string,
  recipient: string,
  type: string,
  windowMs: number,
): boolean {
  maybePrune(windowMs);
  const key = `${type}:${actor}:${recipient}`;
  const last = debounceMap.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < windowMs) return false;
  debounceMap.set(key, now);
  return true;
}
