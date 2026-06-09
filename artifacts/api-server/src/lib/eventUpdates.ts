import { EventEmitter } from "events";

// In-memory pub/sub for event mutations.
// When any mutation endpoint (RSVP, patch, join, tasks, costs, polls, messages)
// completes successfully, it calls emitEventUpdate(eventId). All SSE clients
// watching that event receive an "update" event immediately.
const emitter = new EventEmitter();
emitter.setMaxListeners(0); // No cap — one listener per connected SSE client

export function emitEventUpdate(eventId: string): void {
  emitter.emit(`event:${eventId}`);
}

export function onEventUpdate(eventId: string, handler: () => void): () => void {
  emitter.on(`event:${eventId}`, handler);
  return () => {
    emitter.off(`event:${eventId}`, handler);
  };
}
