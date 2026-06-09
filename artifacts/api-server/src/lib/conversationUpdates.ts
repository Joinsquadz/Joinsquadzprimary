import { EventEmitter } from "events";

// In-memory pub/sub for conversation mutations.
// When a new message is sent, emitConversationUpdate(conversationId) is called.
// All SSE clients watching that conversation receive an "update" event immediately.
const emitter = new EventEmitter();
emitter.setMaxListeners(0); // No cap — one listener per connected SSE client

export function emitConversationUpdate(conversationId: string): void {
  emitter.emit(`conversation:${conversationId}`);
}

export function onConversationUpdate(conversationId: string, handler: () => void): () => void {
  emitter.on(`conversation:${conversationId}`, handler);
  return () => {
    emitter.off(`conversation:${conversationId}`, handler);
  };
}
