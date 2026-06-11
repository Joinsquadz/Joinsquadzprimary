import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

export type ConversationStreamStatus = "connected" | "reconnecting" | "error";

type Options = {
  conversationId: string | null;
  authToken: string | null;
  onUpdate: () => void;
};

const MAX_RETRIES = 10;

/**
 * Opens a Server-Sent Events connection to /api/conversations/:id/stream while
 * the screen is focused. When the server broadcasts an "update" event (a new
 * message was sent by any participant), onUpdate() is called immediately so the
 * screen can re-fetch the latest messages.
 *
 * The connection is automatically closed when the screen loses focus and
 * re-opened when it regains focus. It is also torn down and re-established
 * whenever the app transitions from background → active (AppState "active"),
 * because mobile OSes silently kill background TCP connections.
 *
 * Returns a `status` field: "connected" while the stream is alive,
 * "reconnecting" while establishing or retrying, "error" after too many
 * failed attempts (user should see a persistent indicator).
 */
export function useConversationStream({
  conversationId,
  authToken,
  onUpdate,
}: Options): { status: ConversationStreamStatus; retry: () => void } {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const abortRef = useRef<AbortController | null>(null);
  const focusedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  const [status, setStatus] = useState<ConversationStreamStatus>("reconnecting");

  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (!conversationId) return;

    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("reconnecting");

    const scheduleRetry = () => {
      if (controller.signal.aborted || !focusedRef.current) return;

      retryCountRef.current += 1;
      if (retryCountRef.current > MAX_RETRIES) {
        setStatus("error");
        return;
      }

      const delay = Math.min(2000 * retryCountRef.current, 30_000);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (focusedRef.current) connectRef.current();
      }, delay);
    };

    const run = async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/conversations/${conversationId}/stream`,
          {
            headers: {
              Accept: "text/event-stream",
              "Cache-Control": "no-cache",
              ...buildAuthHeaders(authToken),
            },
            signal: controller.signal,
          },
        );

        if (!response.ok || !response.body) {
          scheduleRetry();
          return;
        }

        retryCountRef.current = 0;
        setStatus("connected");

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
            if (block.includes("event: update")) {
              onUpdateRef.current();
            }
          }
        }

        reader.releaseLock();
        scheduleRetry();
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        scheduleRetry();
      }
    };

    void run();
  }, [conversationId, authToken]);

  connectRef.current = connect;

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      retryCountRef.current = 0;
      connect();

      return () => {
        focusedRef.current = false;
        if (retryTimerRef.current !== null) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        abortRef.current?.abort();
        abortRef.current = null;
        setStatus("reconnecting");
      };
    }, [connect]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && focusedRef.current) {
        retryCountRef.current = 0;
        connect();
      }
    });
    return () => sub.remove();
  }, [connect]);

  // Manual retry: reset the failure counter and reconnect immediately. Used by
  // the "Live updates unavailable" banner so the user can recover after the
  // automatic retries are exhausted.
  const retry = useCallback(() => {
    if (!focusedRef.current) focusedRef.current = true;
    retryCountRef.current = 0;
    connect();
  }, [connect]);

  return { status, retry };
}
