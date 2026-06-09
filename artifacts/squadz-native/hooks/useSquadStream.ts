import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

export type SquadStreamStatus = "connected" | "reconnecting" | "error";

type Options = {
  squadId: string | null;
  authToken: string | null;
  onUpdate: () => void;
};

const MAX_RETRIES = 10;

/**
 * Opens a Server-Sent Events connection to /api/squads/:id/stream while the
 * screen is focused. When the server broadcasts an "update" event (squad was
 * mutated by another member), onUpdate() is called immediately.
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
export function useSquadStream({ squadId, authToken, onUpdate }: Options): { status: SquadStreamStatus } {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const abortRef = useRef<AbortController | null>(null);
  const focusedRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  const [status, setStatus] = useState<SquadStreamStatus>("reconnecting");

  // Stable ref to always call the latest `connect` from async callbacks.
  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (!squadId) return;

    // Cancel any pending retry.
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    // Tear down any existing connection before opening a new one.
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

      // Exponential back-off capped at 30 s.
      const delay = Math.min(2000 * retryCountRef.current, 30_000);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (focusedRef.current) connectRef.current();
      }, delay);
    };

    const run = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/squads/${squadId}/stream`, {
          headers: {
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
            ...buildAuthHeaders(authToken),
          },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          scheduleRetry();
          return;
        }

        // Stream established — reset retry counter and announce "connected".
        retryCountRef.current = 0;
        setStatus("connected");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE messages are separated by blank lines (\n\n).
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";

          for (const block of blocks) {
            if (block.includes("event: update")) {
              onUpdateRef.current();
            }
          }
        }

        reader.releaseLock();

        // Stream closed cleanly (server restart, proxy timeout, etc.). Retry
        // only if the screen is still focused and this wasn't an intentional abort.
        scheduleRetry();
      } catch (err) {
        // AbortError is expected when we intentionally close the connection.
        if (err instanceof Error && err.name === "AbortError") return;
        // Network failure while focused.
        scheduleRetry();
      }
    };

    void run();
  }, [squadId, authToken]);

  // Keep the ref current so the retry timer always calls the latest connect.
  connectRef.current = connect;

  // Open the stream on focus; close it on blur.
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

  // Reconnect when the app returns from the background while this screen is
  // focused. Mobile OSes silently drop TCP connections after a few seconds in
  // the background, so the existing SSE stream is already dead by the time the
  // user opens the app again. Without this the 60 s poll is the only recovery.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && focusedRef.current) {
        retryCountRef.current = 0;
        connect();
      }
    });
    return () => sub.remove();
  }, [connect]);

  return { status };
}
