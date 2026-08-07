import { pgNotify, pgSubscribe } from "./pgPubSub";

// Cross-instance pub/sub for squad mutations via Postgres LISTEN/NOTIFY.
// When any mutation endpoint (PATCH, join, leave, add-member, remove-member)
// completes successfully it calls emitSquadUpdate(squadId). All SSE clients
// watching that squad receive an "update" event immediately — regardless of
// which server instance handled the mutation.

export function emitSquadUpdate(squadId: string): void {
  pgNotify("squadz_squad", squadId);
}

export function onSquadUpdate(squadId: string, handler: () => void): () => void {
  return pgSubscribe("squadz_squad", squadId, handler);
}
