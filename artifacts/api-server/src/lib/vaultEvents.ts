import { EventEmitter } from "events";

// In-memory pub/sub for vault media interactions (caption edits, hearts,
// comments) scoped to a single photo. A client viewing a photo's detail screen
// subscribes by photoId and refetches on each update. Kept in its own namespace
// to avoid cross-contamination with squad/feed SSE channels.
const emitter = new EventEmitter();
emitter.setMaxListeners(0); // No cap — one listener per connected SSE client

export function emitVaultPhotoUpdate(photoId: number): void {
  emitter.emit(`vault-photo:${photoId}`);
}

export function onVaultPhotoUpdate(photoId: number, handler: () => void): () => void {
  emitter.on(`vault-photo:${photoId}`, handler);
  return () => {
    emitter.off(`vault-photo:${photoId}`, handler);
  };
}
