import { EventEmitter } from "events";

// In-memory pub/sub for activity-feed updates. A separate namespace from
// feed/squad/conversation channels so the activity SSE stream and badge count
// only react to genuine activity rows, not every feed mutation.
const emitter = new EventEmitter();
emitter.setMaxListeners(0); // No cap — one listener per connected SSE client

export function emitActivityUpdate(userId: string): void {
  emitter.emit(`activity:${userId}`);
}

export function onActivityUpdate(userId: string, handler: () => void): () => void {
  emitter.on(`activity:${userId}`, handler);
  return () => {
    emitter.off(`activity:${userId}`, handler);
  };
}
