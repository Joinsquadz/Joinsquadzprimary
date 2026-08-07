import { pgNotify, pgSubscribe } from "./pgPubSub";

// Cross-instance pub/sub for event mutations via Postgres LISTEN/NOTIFY.
// When any mutation endpoint (RSVP, patch, join, tasks, costs, polls, messages)
// completes successfully it calls emitEventUpdate(eventId). All SSE clients
// watching that event receive an "update" event immediately — regardless of
// which instance handled the mutation.

export function emitEventUpdate(eventId: string): void {
  pgNotify("squadz_event", eventId);
}

export function onEventUpdate(eventId: string, handler: () => void): () => void {
  return pgSubscribe("squadz_event", eventId, handler);
}
