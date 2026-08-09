import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AppContext";
import {
  useMessages,
  type ChatAttachment,
  type ChatMessage,
  type ChatParticipant,
} from "@/context/MessagesContext";
import { useConversationStream } from "@/hooks/useConversationStream";
import {
  INITIAL_AUTH_RACE_STATE,
  applyVaultFetchOutcome,
  nextRetryDecision,
  resetAuthRaceState,
  type AuthRaceState,
} from "@/lib/vaultAuthRace";

/**
 * Plan (event / trip) chat, backed by a real conversation thread.
 *
 * Chat used to be an array on the event record: the whole history shipped with
 * every event fetch, sends bumped the event's optimistic-concurrency version
 * (so two people typing at once collided), and "read" was a client-only
 * AsyncStorage map. This hook talks to the same paginated conversation
 * infrastructure the DM/squad screens use — cursor pagination, server-side read
 * receipts, SSE, attachments.
 *
 * `active` should be true only while the chat tab is actually on screen: the
 * thread is created lazily on first open, and the SSE connection should not be
 * held open behind the itinerary tab.
 */

export type PlanChat = {
  conversationId: string | null;
  messages: ChatMessage[];
  participants: ChatParticipant[];
  loading: boolean;
  /** A pre-token-restore 401 is being retried — show a spinner, not "no messages". */
  authPending: boolean;
  authError: boolean;
  retry: () => void;
  /** The plan is no longer visible to this user (removed from the squad, uninvited…). */
  denied: boolean;
  hasMore: boolean;
  loadingOlder: boolean;
  loadOlder: () => Promise<void>;
  send: (text: string, attachments?: ChatAttachment[]) => Promise<{ error?: string }>;
  sending: boolean;
};

export function useEventChat(eventId: string | undefined, active: boolean): PlanChat {
  const { authToken } = useAuth();
  const { getEventConversation, fetchThread, sendMessage, markRead } = useMessages();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<ChatParticipant[]>([]);
  const [loading, setLoading] = useState(false);
  const [authRace, setAuthRace] = useState<AuthRaceState>(INITIAL_AUTH_RACE_STATE);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);

  const loadingOlderRef = useRef(false);
  // Once the user has paged back, a refresh of the LATEST page must not reset
  // the cursor — that would forget how far back they've already loaded.
  const hasPagedRef = useRef(false);

  // Reset everything when the screen instance is reused for a different plan,
  // so one plan's history can never bleed into another's.
  useEffect(() => {
    setConversationId(null);
    setDenied(false);
    setMessages([]);
    setParticipants([]);
    setHasMore(false);
    setNextCursor(null);
    hasPagedRef.current = false;
  }, [eventId]);

  // Lazily open (get-or-create) the thread the first time the chat tab is shown.
  useEffect(() => {
    if (!active || !eventId || conversationId || !authToken) return;
    let cancelled = false;
    setLoading(true);
    void getEventConversation(eventId).then((id) => {
      if (cancelled) return;
      if (!id) {
        // Either a genuine loss of access or a pre-token-restore race; the
        // auth-race driver below decides which by retrying.
        setLoading(false);
        setAuthRace((prev) => applyVaultFetchOutcome(prev, { kind: "unauthorized" }));
        return;
      }
      setConversationId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [active, eventId, conversationId, authToken, getEventConversation]);

  const loadThread = useCallback(
    async (showSpinner: boolean, track = false) => {
      if (!conversationId) return;
      if (showSpinner) setLoading(true);
      const result = await fetchThread(conversationId);
      if (result.kind === "ok") {
        const data = result.data;
        setDenied(false);
        setMessages((prev) => {
          const serverIds = new Set(data.messages.map((m) => m.id));
          // Keep already-loaded OLDER pages (merge by id) so a poll/SSE refresh
          // of the latest page never wipes them, and keep in-flight optimistic
          // messages at the tail.
          const pending = prev.filter((m) => m.pending || m.failed);
          const olderKept = prev.filter((m) => !m.pending && !m.failed && !serverIds.has(m.id));
          const merged = [...olderKept, ...data.messages].sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
          return [...merged, ...pending.filter((p) => !serverIds.has(p.id))];
        });
        setParticipants(data.participants);
        if (!hasPagedRef.current) {
          setHasMore(data.hasMore);
          setNextCursor(data.nextCursor);
        }
      } else if (result.kind === "failure") {
        // A non-401 failure on a thread we already opened means access was
        // revoked (or the plan was deleted) while the screen was open.
        setDenied(messages.length === 0);
      }
      if (track) setAuthRace((prev) => applyVaultFetchOutcome(prev, { kind: result.kind }));
      if (showSpinner) setLoading(false);
    },
    // `messages.length` is read only to decide the denied fallback; including
    // the whole array would re-create this callback on every new message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversationId, fetchThread, messages.length],
  );

  // First load + mark read once the thread id is known and the tab is open.
  useEffect(() => {
    if (!active || !conversationId) return;
    void loadThread(true, true);
    void markRead(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, conversationId]);

  // Auth-race retry driver (see lib/vaultAuthRace.ts): a 401 before the token
  // finishes restoring must keep the tab on a spinner and retry, not flash an
  // empty thread or a false "you don't have access".
  useEffect(() => {
    if (!active) return;
    const decision = nextRetryDecision(authRace);
    if (decision.action === "give-up") {
      setAuthRace(decision.next);
      return;
    }
    if (decision.action === "retry") {
      const t = setTimeout(() => {
        if (conversationId) void loadThread(false, true);
        else if (eventId) {
          void getEventConversation(eventId).then((id) => {
            if (id) setConversationId(id);
            else setAuthRace((prev) => applyVaultFetchOutcome(prev, { kind: "unauthorized" }));
          });
        }
      }, decision.delayMs);
      return () => clearTimeout(t);
    }
  }, [active, authRace, conversationId, eventId, getEventConversation, loadThread]);

  const retry = useCallback(() => {
    setAuthRace(resetAuthRaceState());
    setDenied(false);
    if (conversationId) void loadThread(true, true);
  }, [conversationId, loadThread]);

  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMore || !nextCursor || !conversationId) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const result = await fetchThread(conversationId, nextCursor);
    if (result.kind === "ok") {
      hasPagedRef.current = true;
      setMessages((prev) => {
        const existing = new Set(prev.map((m) => m.id));
        return [...result.data.messages.filter((m) => !existing.has(m.id)), ...prev];
      });
      setHasMore(result.data.hasMore);
      setNextCursor(result.data.nextCursor);
    }
    loadingOlderRef.current = false;
    setLoadingOlder(false);
  }, [conversationId, fetchThread, hasMore, nextCursor]);

  // Live updates for everyone in the thread. Only connects while the chat tab
  // is open (conversationId is null until then).
  useConversationStream({
    conversationId: active ? conversationId : null,
    authToken,
    onUpdate: useCallback(() => {
      if (!conversationId) return;
      void loadThread(false).then(() => markRead(conversationId));
    }, [conversationId, loadThread, markRead]),
  });

  const send = useCallback(
    async (text: string, attachments: ChatAttachment[] = []): Promise<{ error?: string }> => {
      if (!conversationId) return { error: "Chat isn't ready yet — try again in a moment." };
      setSending(true);
      try {
        const result = await sendMessage(conversationId, text, attachments);
        if (!result.ok) {
          return {
            error: result.blocked
              ? "You can't post in this chat."
              : "Could not send message. Please try again.",
          };
        }
        setMessages((prev) =>
          prev.some((m) => m.id === result.message.id) ? prev : [...prev, result.message],
        );
        return {};
      } finally {
        setSending(false);
      }
    },
    [conversationId, sendMessage],
  );

  return {
    conversationId,
    messages,
    participants,
    loading,
    authPending: authRace.authPending,
    authError: authRace.authError,
    retry,
    denied,
    hasMore,
    loadingOlder,
    loadOlder,
    send,
    sending,
  };
}
