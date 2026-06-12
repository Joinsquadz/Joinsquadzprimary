import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { API_BASE, buildAuthHeaders } from "@/lib/api";
import { useAuth } from "@/context/AppContext";
import { useActivityStream } from "@/hooks/useActivityStream";

type ActivityContextType = {
  /** Unread activity count (capped at 99 by the server). */
  unreadCount: number;
  /** Re-fetch the unread count from the server. */
  refreshUnread: () => void;
  /** Mark everything read (server + local), e.g. when the screen opens. */
  markAllRead: () => void;
  /** Subscribe to "a new activity arrived" pings (for the open feed screen). */
  subscribe: (listener: () => void) => () => void;
};

const ActivityContext = createContext<ActivityContextType>({
  unreadCount: 0,
  refreshUnread: () => {},
  markAllRead: () => {},
  subscribe: () => () => {},
});

export function useActivity(): ActivityContextType {
  return useContext(ActivityContext);
}

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  const { authToken, isLoggedIn } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const listenersRef = useRef<Set<() => void>>(new Set());
  const authTokenRef = useRef<string | null>(null);
  authTokenRef.current = authToken;

  const refreshUnread = useCallback(() => {
    const token = authTokenRef.current;
    if (!token) {
      setUnreadCount(0);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/activity/unread-count`, {
          headers: buildAuthHeaders(token),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { count: number };
        setUnreadCount(typeof data.count === "number" ? data.count : 0);
      } catch {
        // Leave the last known count in place on network failure.
      }
    })();
  }, []);

  const markAllRead = useCallback(() => {
    const token = authTokenRef.current;
    setUnreadCount(0);
    if (!token) return;
    void (async () => {
      try {
        await fetch(`${API_BASE}/api/activity/read`, {
          method: "POST",
          headers: buildAuthHeaders(token),
        });
      } catch {
        // Best-effort; the next refresh will reconcile.
      }
    })();
  }, []);

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  // A new activity row arrived via SSE: bump the badge and ping the open screen.
  const handleStreamUpdate = useCallback(() => {
    refreshUnread();
    listenersRef.current.forEach((l) => l());
  }, [refreshUnread]);

  useActivityStream({ authToken, onUpdate: handleStreamUpdate });

  // Initial + auth-change fetch, plus a foreground refresh as an SSE backstop.
  useEffect(() => {
    if (!isLoggedIn || !authToken) {
      setUnreadCount(0);
      return;
    }
    refreshUnread();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") refreshUnread();
    });
    return () => sub.remove();
  }, [isLoggedIn, authToken, refreshUnread]);

  const value = useMemo(
    () => ({ unreadCount, refreshUnread, markAllRead, subscribe }),
    [unreadCount, refreshUnread, markAllRead, subscribe],
  );

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}
