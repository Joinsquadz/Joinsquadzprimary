import { EventEmitter } from "events";

// In-memory pub/sub for availability-poll mutations.
// When a poll endpoint (member submits availability, host updates the range, or
// host nudges a member) completes successfully, it calls emitPollUpdate(pollId).
// All SSE clients watching that poll receive an "update" event immediately.
const emitter = new EventEmitter();
emitter.setMaxListeners(0); // No cap — one listener per connected SSE client

export function emitPollUpdate(pollId: string): void {
  emitter.emit(`poll:${pollId}`);
}

export function onPollUpdate(pollId: string, handler: () => void): () => void {
  emitter.on(`poll:${pollId}`, handler);
  return () => {
    emitter.off(`poll:${pollId}`, handler);
  };
}
