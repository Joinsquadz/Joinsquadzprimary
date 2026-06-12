import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
// React Native's built-in fetch resolves response.body to null, so a streaming
// SSE reader could never start on a device. expo/fetch returns a real streaming
// body on both native and web.
import { fetch as streamFetch } from "expo/fetch";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

type Options = {
  authToken: string | null;
  onUpdate: () => void;
};

/**
 * Opens a Server-Sent Events connection to /api/activity/stream for the lifetime
 * of the app session (not focus-scoped — the badge must update even while the
 * user is on another tab). Emits onUpdate() whenever a new activity row is
 * recorded for this user. Reconnects on app foreground (mobile OSes drop
 * background TCP connections).
 */
// Delay before re-opening a dropped stream. Servers/proxies close idle SSE
// sockets and mobile networks flap; without this the badge would only recover
// on the next app-foreground.
const RECONNECT_MS = 15000;

export function useActivityStream({ authToken, onUpdate }: Options): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const abortRef = useRef<AbortController | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);

  const connect = useCallback(() => {
    if (!authToken) return;
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
        const response = await streamFetch(`${API_BASE}/api/activity/stream`, {
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
        // Server closed the stream (EOF) — re-open after a short delay.
        scheduleReconnect();
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          scheduleReconnect();
        }
      }
    };

    void run();
  }, [authToken]);

  useEffect(() => {
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
  }, [connect]);
}
