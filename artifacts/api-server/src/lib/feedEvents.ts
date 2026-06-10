import { EventEmitter } from "events";

// In-memory pub/sub for feed mutations (posts, reactions, comments, moments).
// Uses a separate namespace from squad/conversation channels to prevent
// cross-contamination with existing SSE streams.
const emitter = new EventEmitter();
emitter.setMaxListeners(0); // No cap — one listener per connected SSE client

export function emitFeedUpdate(userId: string): void {
  emitter.emit(`feed:${userId}`);
}

export function onFeedUpdate(userId: string, handler: () => void): () => void {
  emitter.on(`feed:${userId}`, handler);
  return () => {
    emitter.off(`feed:${userId}`, handler);
  };
}
