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

export type ChatAttachment = {
  kind: "image" | "video";
  url: string;
  width?: number;
  height?: number;
};

export type ConversationListItem = {
  id: string;
  type: "direct" | "squad";
  title: string;
  emoji: string | null;
  color: string | null;
  squadId: string | null;
  otherUserId: string | null;
  otherUserImageUrl?: string | null;
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
  conversation: { id: string; type: string; squadId: string | null };
  messages: ChatMessage[];
  participants: ChatParticipant[];
};

type MessagesContextType = {
  conversations: ConversationListItem[];
  conversationsLoading: boolean;
  unreadCount: number;
  refreshConversations: () => Promise<void>;
  refreshUnread: () => Promise<void>;
  fetchThread: (conversationId: string) => Promise<ThreadData | null>;
  sendMessage: (
    conversationId: string,
    text: string,
    attachments: ChatAttachment[],
  ) => Promise<ChatMessage | null>;
  markRead: (conversationId: string) => Promise<void>;
  startDirectConversation: (userId: string) => Promise<string | null>;
  getSquadConversation: (squadId: string) => Promise<string | null>;
};

const MessagesContext = createContext<MessagesContextType | null>(null);

const POLL_INTERVAL_MS = 8000;

export function MessagesProvider({ children }: { children: React.ReactNode }) {
  const { authToken } = useAuth();
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
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

  const refreshConversations = useCallback(async () => {
    if (!tokenRef.current) {
      setConversations([]);
      return;
    }
    try {
      const res = await apiFetch("/api/conversations");
      if (!res.ok) return;
      const data = (await res.json()) as ConversationListItem[];
      setConversations(data);
      setUnreadCount(data.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0));
    } catch {
      // Network unavailable — keep current data.
    }
  }, [apiFetch]);

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
    async (conversationId: string): Promise<ThreadData | null> => {
      try {
        const res = await apiFetch(`/api/conversations/${conversationId}/messages`);
        if (!res.ok) return null;
        return (await res.json()) as ThreadData;
      } catch {
        return null;
      }
    },
    [apiFetch],
  );

  const sendMessage = useCallback(
    async (
      conversationId: string,
      text: string,
      attachments: ChatAttachment[],
    ): Promise<ChatMessage | null> => {
      try {
        const res = await apiFetch(`/api/conversations/${conversationId}/messages`, {
          method: "POST",
          body: JSON.stringify({ text, attachments }),
        });
        if (!res.ok) return null;
        const message = (await res.json()) as ChatMessage;
        // Reflect new activity in the list/badge promptly.
        void refreshConversations();
        return message;
      } catch {
        return null;
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
        if (!res.ok) return null;
        const { id } = (await res.json()) as { id: string };
        return id;
      } catch {
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

  // Initial + token-change load.
  useEffect(() => {
    if (!authToken) {
      setConversations([]);
      setUnreadCount(0);
      return;
    }
    setConversationsLoading(true);
    void refreshConversations().finally(() => setConversationsLoading(false));
  }, [authToken, refreshConversations]);

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
      unreadCount,
      refreshConversations,
      refreshUnread,
      fetchThread,
      sendMessage,
      markRead,
      startDirectConversation,
      getSquadConversation,
    }),
    [
      conversations,
      conversationsLoading,
      unreadCount,
      refreshConversations,
      refreshUnread,
      fetchThread,
      sendMessage,
      markRead,
      startDirectConversation,
      getSquadConversation,
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
