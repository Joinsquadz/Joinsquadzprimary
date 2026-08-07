import { pgNotify, pgSubscribe } from "./pgPubSub";

// Cross-instance pub/sub for vault media interactions (caption edits, hearts,
// comments) scoped to a single photo via Postgres LISTEN/NOTIFY. A client
// viewing a photo's detail screen subscribes by photoId and refetches on each
// update. Kept in its own namespace to avoid cross-contamination with
// squad/feed SSE channels.

export function emitVaultPhotoUpdate(photoId: number): void {
  pgNotify("squadz_vault", String(photoId));
}

export function onVaultPhotoUpdate(
  photoId: number,
  handler: () => void,
): () => void {
  return pgSubscribe("squadz_vault", String(photoId), handler);
}
