import { pgNotify, pgSubscribe } from "./pgPubSub";

// Cross-instance pub/sub for availability-poll mutations via Postgres
// LISTEN/NOTIFY. When a poll endpoint (member submits availability, host
// updates the range, or host nudges a member) completes successfully it calls
// emitPollUpdate(pollId). All SSE clients watching that poll receive an
// "update" event immediately — regardless of which instance handled the write.

export function emitPollUpdate(pollId: string): void {
  pgNotify("squadz_poll", pollId);
}

export function onPollUpdate(pollId: string, handler: () => void): () => void {
  return pgSubscribe("squadz_poll", pollId, handler);
}
