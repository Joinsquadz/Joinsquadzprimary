import { pgNotify, pgSubscribe } from "./pgPubSub";

// Cross-instance pub/sub for feed mutations (posts, reactions, comments,
// moments) via Postgres LISTEN/NOTIFY. Uses a separate namespace from
// squad/conversation channels to prevent cross-contamination with existing
// SSE streams.

export function emitFeedUpdate(userId: string): void {
  pgNotify("squadz_feed", userId);
}

export function onFeedUpdate(userId: string, handler: () => void): () => void {
  return pgSubscribe("squadz_feed", userId, handler);
}
