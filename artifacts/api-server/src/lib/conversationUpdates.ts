import { pgNotify, pgSubscribe } from "./pgPubSub";

// Cross-instance pub/sub for conversation mutations via Postgres LISTEN/NOTIFY.
// When a new message is sent, emitConversationUpdate(conversationId) is called.
// All SSE clients watching that conversation receive an "update" event
// immediately — regardless of which server instance handled the POST.

export function emitConversationUpdate(conversationId: string): void {
  pgNotify("squadz_conv", conversationId);
}

export function onConversationUpdate(
  conversationId: string,
  handler: () => void,
): () => void {
  return pgSubscribe("squadz_conv", conversationId, handler);
}
