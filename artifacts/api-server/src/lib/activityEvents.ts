import { pgNotify, pgSubscribe } from "./pgPubSub";

// Cross-instance pub/sub for activity-feed updates via Postgres LISTEN/NOTIFY.
// A separate namespace from feed/squad/conversation channels so the activity
// SSE stream and badge count only react to genuine activity rows, not every
// feed mutation.

export function emitActivityUpdate(userId: string): void {
  pgNotify("squadz_activity", userId);
}

export function onActivityUpdate(userId: string, handler: () => void): () => void {
  return pgSubscribe("squadz_activity", userId, handler);
}
