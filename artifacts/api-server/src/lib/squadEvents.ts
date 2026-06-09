import { EventEmitter } from "events";

// In-memory pub/sub for squad mutations.
// When any mutation endpoint (PATCH, join, leave, add-member, remove-member)
// completes successfully, it calls emitSquadUpdate(squadId). All SSE clients
// watching that squad receive an "update" event immediately.
const emitter = new EventEmitter();
emitter.setMaxListeners(0); // No cap — one listener per connected SSE client

export function emitSquadUpdate(squadId: string): void {
  emitter.emit(`squad:${squadId}`);
}

export function onSquadUpdate(squadId: string, handler: () => void): () => void {
  emitter.on(`squad:${squadId}`, handler);
  return () => {
    emitter.off(`squad:${squadId}`, handler);
  };
}
