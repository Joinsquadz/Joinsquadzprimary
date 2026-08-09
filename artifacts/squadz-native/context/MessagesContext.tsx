import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { AppState } from "react-native";
import { API_BASE } from "@/lib/api";
import { useAuth } from "@/context/AppContext";
// Shared auth-race guard (see lib/vaultAuthRace.ts). A pre-token-restore 401 on
// the initial conversations load must keep the Messages screen loading instead
// of flashing an empty "No conversations" state during a slow login.
import {
  INITIAL_AUTH_RACE_STATE,
  applyVaultFetchOutcome,
  nextRetryDecision,
  resetAuthRaceState,
  type AuthRaceState,
} from "@/lib/vaultAuthRace";

export type ChatAttachment = {
  kind: "image" | "video";
  url: string;
  width?: number;
  height?: number;
};

export type ConversationType = "direct" | "squad" | "event";

export type ConversationListItem = {
  id: string;
  type: ConversationType;
  title: string;
  emoji: string | null;
  color: string | null;
  squadId: string | null;
  otherUserId: string | null;
  otherUserImageUrl?: string | null;
  // Set only on plan ("event") threads. `eventType` discriminates a plain event
  // from a trip so the inbox can route the row to the right detail screen.
  eventId: string | null;
  eventType: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastMessageSenderId: string;
  unreadCount: number;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  attachments: ChatAttachment[];
  createdAt: string;
  pending?: boolean;
  failed?: boolean;
};

export type ChatParticipant = {
  userId: string;
  lastReadAt: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  profileImageUrl: string | null;
};

export type ThreadData = {
  conversation: { id: string; type: string; squadId: string | null; eventId?: string | null };
  messages: ChatMessage[];
  participants: ChatParticipant[];
  // Cursor pagination: hasMore = older messages exist before this page;
  // nextCursor = the messageId to pass as ?before to fetch that older page.
  hasMore: boolean;
  nextCursor: string | null;
};

// Result of a send. `blocked` distinguishes a 403 blocked-thread rejection
// (either party has blocked the other) from a generic failure, so the
// conversation screen can swap the composer for a neutral read-only state.
export type SendMessageResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; blocked: boolean };

// Result of a thread fetch, tagged with the HTTP outcome so the conversation
// screen can drive the shared auth-race guard (lib/vaultAuthRace.ts): a
// pre-token-restore 401 on a cold start / deep-link open must keep the screen
// loading instead of flashing the "No messages yet" empty state. `kind` mirrors
// VaultFetchOutcome so it can be passed straight to applyVaultFetchOutcome.
export type ThreadFetchResult =
  | { kind: "unauthorized" }
  | { kind: "failure" }
  | { kind: "ok"; data: ThreadData };

type MessagesContextType = {
  conversations: ConversationListItem[];
  conversationsLoading: boolean;
  // Auth-race state for the initial conversations load. `authPending` = a
  // pre-token-restore 401 is being retried (show a spinner, not an empty state);
  // `authError` = retries exhausted (show the retry UI).
  conversationsAuthPending: boolean;
  conversationsAuthError: boolean;
  retryConversations: () => void;
  unreadCount: number;
  refreshConversations: () => Promise<void>;
  refreshUnread: () => Promise<void>;
  // `before` = messageId cursor; when set, fetches the page of OLDER messages
  // before that id (infinite scroll up). Omit for the latest page.
  fetchThread: (conversationId: string, before?: string) => Promise<ThreadFetchResult>;
  sendMessage: (
    conversationId: string,
    text: string,
    attachments: ChatAttachment[],
  ) => Promise<SendMessageResult>;
  markRead: (conversationId: string) => Promise<void>;
  startDirectConversation: (userId: string) => Promise<string | null>;
  getSquadConversation: (squadId: string) => Promise<string | null>;
  /**
   * Get-or-create the chat thread for a plan (event OR trip). Returns null when
   * the plan is gone or the user can no longer see it. Plan chat used to live
   * as JSONB on the event with client-only read tracking; it is now an ordinary
   * paginated conversation with server-side read receipts.
   */
  getEventConversation: (eventId: string) => Promise<string | null>;
};

const MessagesContext = createContext<MessagesContextType | null>(null);

const POLL_INTERVAL_MS = 8000;

export function MessagesProvider({ children }: { children: React.ReactNode }) {
  const { authToken } = useAuth();
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  // Auth-race state for the initial conversations load (see lib/vaultAuthRace.ts).
  // Only the cold-start load path feeds this — silent polling never touches it,
  // so a transient poll 401 can't flash an already-populated list to a spinner.
  const [conversationsAuth, setConversationsAuth] = useState<AuthRaceState>(INITIAL_AUTH_RACE_STATE);
  const [unreadCount, setUnreadCount] = useState(0);
  const tokenRef = useRef<string | null>(authToken);
  tokenRef.current = authToken;

  const apiFetch = useCallback(
    async (path: string, options?: RequestInit) => {
      const token = tokenRef.current;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options?.headers as Record<string, string>),
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      return fetch(`${API_BASE}${path}`, { ...options, headers });
    },
    [],
  );

  // Core conversations fetch. `track` controls whether this attempt feeds the
  // auth-race guard: the cold-start load + its retries pass true (so a
  // pre-token-restore 401 keeps the screen loading instead of flashing empty),
  // while silent polling / post-send refreshes pass false (a transient 401
  // there must not yank an already-populated list back to a spinner).
  const loadConversations = useCallback(
    async (track: boolean) => {
      if (!tokenRef.current) {
        // Genuinely logged out — clear, and don't arm an auth-race retry loop.
        setConversations([]);
        return;
      }
      try {
        const res = await apiFetch("/api/conversations");
        if (res.status === 401) {
          if (track) setConversationsAuth(prev => applyVaultFetchOutcome(prev, { kind: "unauthorized" }));
          return;
        }
        if (!res.ok) {
          if (track) setConversationsAuth(prev => applyVaultFetchOutcome(prev, { kind: "failure" }));
          return;
        }
        const data = (await res.json()) as ConversationListItem[];
        setConversations(data);
        setUnreadCount(data.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0));
        if (track) setConversationsAuth(prev => applyVaultFetchOutcome(prev, { kind: "ok" }));
      } catch {
        // Network unavailable — keep current data.
        if (track) setConversationsAuth(prev => applyVaultFetchOutcome(prev, { kind: "failure" }));
      }
    },
    [apiFetch],
  );

  // Silent refresh used by polling / post-send — never engages the auth-race.
  const refreshConversations = useCallback(async () => {
    await loadConversations(false);
  }, [loadConversations]);

  const refreshUnread = useCallback(async () => {
    if (!tokenRef.current) {
      setUnreadCount(0);
      return;
    }
    try {
      const res = await apiFetch("/api/conversations/unread-count");
      if (!res.ok) return;
      const { count } = (await res.json()) as { count: number };
      setUnreadCount(count);
    } catch {
      // Network unavailable — keep current data.
    }
  }, [apiFetch]);

  const fetchThread = useCallback(
    async (conversationId: string, before?: string): Promise<ThreadFetchResult> => {
      try {
        const qs = before ? `?before=${encodeURIComponent(before)}` : "";
        const res = await apiFetch(`/api/conversations/${conversationId}/messages${qs}`);
        // A 401 almost always means the auth token hasn't finished restoring yet
        // (cold start / deep-link open / token-refresh race). Surface it so the
        // screen can stay loading and retry instead of flashing a false empty.
        if (res.status === 401) return { kind: "unauthorized" };
        if (!res.ok) return { kind: "failure" };
        return { kind: "ok", data: (await res.json()) as ThreadData };
      } catch {
        return { kind: "failure" };
      }
    },
    [apiFetch],
  );

  const sendMessage = useCallback(
    async (
      conversationId: string,
      text: string,
      attachments: ChatAttachment[],
    ): Promise<SendMessageResult> => {
      try {
        const res = await apiFetch(`/api/conversations/${conversationId}/messages`, {
          method: "POST",
          body: JSON.stringify({ text, attachments }),
        });
        if (!res.ok) {
          // 403 on a send means the thread is blocked (either party blocked the
          // other). Prefer the explicit { blocked: true } body flag, but treat
          // any 403 as blocked so the screen can swap in the read-only state.
          if (res.status === 403) {
            try {
              const body = (await res.json()) as { blocked?: boolean };
              return { ok: false, blocked: body?.blocked !== false };
            } catch {
              return { ok: false, blocked: true };
            }
          }
          return { ok: false, blocked: false };
        }
        const message = (await res.json()) as ChatMessage;
        // Reflect new activity in the list/badge promptly.
        void refreshConversations();
        return { ok: true, message };
      } catch {
        return { ok: false, blocked: false };
      }
    },
    [apiFetch, refreshConversations],
  );

  const markRead = useCallback(
    async (conversationId: string) => {
      // Optimistically zero the unread badge for this conversation.
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)),
      );
      try {
        await apiFetch(`/api/conversations/${conversationId}/read`, { method: "POST" });
      } catch {
        // Best-effort; next poll will reconcile.
      }
      void refreshUnread();
    },
    [apiFetch, refreshUnread],
  );

  const startDirectConversation = useCallback(
    async (userId: string): Promise<string | null> => {
      try {
        const res = await apiFetch("/api/conversations/direct", {
          method: "POST",
          body: JSON.stringify({ userId }),
        });
        if (!res.ok) {
          // Read the error body so callers can handle specific codes.
          let body: { code?: string; error?: string } = {};
          try { body = (await res.json()) as typeof body; } catch { /* ignore parse errors */ }
          // Attach the server code to the Error so the caller can branch on it.
          throw Object.assign(
            new Error(body.error ?? "Failed to start conversation"),
            { code: body.code },
          );
        }
        const { id } = (await res.json()) as { id: string };
        return id;
      } catch (err: unknown) {
        // Re-throw errors that carry a server-side code (e.g. NO_SHARED_SQUAD)
        // so callers can show a specific message.  Swallow network / parse
        // errors and return null for a generic fallback.
        if (err instanceof Error && (err as Error & { code?: string }).code) throw err;
        return null;
      }
    },
    [apiFetch],
  );

  const getSquadConversation = useCallback(
    async (squadId: string): Promise<string | null> => {
      try {
        const res = await apiFetch(`/api/conversations/squad/${squadId}`);
        if (!res.ok) return null;
        const { id } = (await res.json()) as { id: string };
        return id;
      } catch {
        return null;
      }
    },
    [apiFetch],
  );

  const getEventConversation = useCallback(
    async (eventId: string): Promise<string | null> => {
      try {
        const res = await apiFetch(`/api/conversations/event/${eventId}`);
        if (!res.ok) return null;
        const { id } = (await res.json()) as { id: string };
        return id;
      } catch {
        return null;
      }
    },
    [apiFetch],
  );

  // Initial + token-change load. Uses the tracked load path so a pre-restore
  // 401 keeps the screen loading + retrying instead of flashing empty.
  useEffect(() => {
    if (!authToken) {
      setConversations([]);
      setUnreadCount(0);
      return;
    }
    setConversationsLoading(true);
    void loadConversations(true).finally(() => setConversationsLoading(false));
  }, [authToken, loadConversations]);

  // Auth-race retry driver: while the cold-start load is auth-pending, re-run it
  // on a short cadence until an authenticated fetch lands, then give up into a
  // retryable error. Only runs while a token is present (a logged-out session
  // clears the list above and never arms this loop).
  useEffect(() => {
    if (!authToken) return;
    const decision = nextRetryDecision(conversationsAuth);
    if (decision.action === "give-up") {
      setConversationsAuth(decision.next);
      return;
    }
    if (decision.action === "retry") {
      const t = setTimeout(() => { void loadConversations(true); }, decision.delayMs);
      return () => clearTimeout(t);
    }
  }, [conversationsAuth, authToken, loadConversations]);

  // Manual retry after the auth-race retries were exhausted (backs the Messages
  // screen's "Try again" button). Clears the error + counter and reloads.
  const retryConversations = useCallback(() => {
    setConversationsAuth(resetAuthRaceState());
    setConversationsLoading(true);
    void loadConversations(true).finally(() => setConversationsLoading(false));
  }, [loadConversations]);

  // Background polling for the badge + list freshness while logged in and active.
  useEffect(() => {
    if (!authToken) return;
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void refreshConversations();
    }, POLL_INTERVAL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshConversations();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [authToken, refreshConversations]);

  const value = useMemo(
    () => ({
      conversations,
      conversationsLoading,
      conversationsAuthPending: conversationsAuth.authPending,
      conversationsAuthError: conversationsAuth.authError,
      retryConversations,
      unreadCount,
      refreshConversations,
      refreshUnread,
      fetchThread,
      sendMessage,
      markRead,
      startDirectConversation,
      getSquadConversation,
      getEventConversation,
    }),
    [
      conversations,
      conversationsLoading,
      conversationsAuth.authPending,
      conversationsAuth.authError,
      retryConversations,
      unreadCount,
      refreshConversations,
      refreshUnread,
      fetchThread,
      sendMessage,
      markRead,
      startDirectConversation,
      getSquadConversation,
      getEventConversation,
    ],
  );

  return (
    <MessagesContext.Provider value={value}>
      {children}
    </MessagesContext.Provider>
  );
}

export function useMessages(): MessagesContextType {
  const ctx = useContext(MessagesContext);
  if (!ctx) throw new Error("useMessages must be used within a MessagesProvider");
  return ctx;
}
