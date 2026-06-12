import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
// expo/fetch gives a real streaming body on native (RN's built-in fetch returns
// response.body === null, so the SSE reader would never start on a device).
import { fetch as streamFetch } from "expo/fetch";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

type Options = {
  authToken: string | null;
  enabled?: boolean;
  onUpdate: () => void;
};

/**
 * Subscribes to /api/feed/stream — the per-user feed/moment update channel.
 * The server emits an update to a moment's author whenever someone views or
 * reacts to their moment, which powers the live view count (B8).
 */
// Re-open delay after the stream drops (idle-socket close / network flap), so a
// live view count doesn't freeze until the next app-foreground.
const RECONNECT_MS = 15000;

export function useFeedStream({ authToken, enabled = true, onUpdate }: Options): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const abortRef = useRef<AbortController | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const connect = useCallback(() => {
    if (!authToken || !enabled) return;
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const scheduleReconnect = () => {
      if (stoppedRef.current || controller.signal.aborted || retryRef.current) return;
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        connect();
      }, RECONNECT_MS);
    };

    const run = async () => {
      try {
        const response = await streamFetch(`${API_BASE}/api/feed/stream`, {
          headers: {
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
            ...buildAuthHeaders(authToken),
          },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          scheduleReconnect();
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            if (block.includes("event: update")) onUpdateRef.current();
          }
        }
        reader.releaseLock();
        scheduleReconnect();
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          scheduleReconnect();
        }
      }
    };

    void run();
  }, [authToken, enabled]);

  useEffect(() => {
    if (!enabled) {
      stoppedRef.current = true;
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    stoppedRef.current = false;
    connect();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") connect();
    });
    return () => {
      stoppedRef.current = true;
      sub.remove();
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [connect, enabled]);
}
