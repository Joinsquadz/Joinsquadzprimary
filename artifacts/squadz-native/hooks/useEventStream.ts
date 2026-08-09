import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
// Expo's streaming-capable fetch. React Native's built-in fetch does NOT
// populate `response.body` (it has no ReadableStream), so the SSE reader below
// could never start and the status was stuck on "reconnecting" forever on a
// device. expo/fetch returns a real streaming body on both native and web.
import { fetch as streamFetch } from "expo/fetch";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

export type EventStreamStatus = "connected" | "reconnecting" | "error";

type Options = {
  eventId: string | null;
  authToken: string | null;
  onUpdate: () => void;
};

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_RETRIES = 10;

/**
 * Opens a Server-Sent Events connection to /api/events/:id/stream while the
 * screen is focused. When the server broadcasts an "update" event (RSVP
 * changed, event edited, message sent, cost/task/poll mutated), onUpdate() is
 * called immediately so the screen can re-fetch the latest state.
 *
 * The connection is automatically closed when the screen loses focus and
 * re-opened when it regains focus. It is also torn down and re-established
 * whenever the app transitions from background → active (AppState "active"),
 * because mobile OSes silently kill background TCP connections.
 *
 * On a network-level error (non-AbortError), the hook retries automatically
 * using exponential backoff (1 s → 2 s → 4 s … capped at 30 s). The backoff
 * resets to the initial value when the stream successfully reconnects. Any
 * pending retry is cancelled on blur or when the app goes to the background.
 *
 * Returns a `status` field: "connected" while the stream is alive,
 * "reconnecting" while establishing or retrying, "error" after too many
 * failed attempts (caller may show a persistent indicator + manual retry).
 */
export function useEventStream({ eventId, authToken, onUpdate }: Options): { status: EventStreamStatus; retry: () => void } {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const abortRef = useRef<AbortController | null>(null);
  // True while the event-detail screen is in the Expo Router focus stack.
  const focusedRef = useRef(false);
  // Holds the current backoff delay in ms; reset on successful connect.
  const retryDelayRef = useRef(INITIAL_BACKOFF_MS);
  // Counts consecutive failures; used to cap retries and show "error" state.
  const retryCountRef = useRef(0);
  // Holds the setTimeout handle for a pending reconnect attempt.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<EventStreamStatus>("reconnecting");

  // Stable ref to always call the latest `connect` from async callbacks.
  const connectRef = useRef<() => void>(() => {});

  const cancelRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!eventId) return;

    // Cancel any pending retry and tear down any existing connection.
    cancelRetry();
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

      // Exponential back-off capped at MAX_BACKOFF_MS.
      const delay = retryDelayRef.current;
      retryDelayRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (focusedRef.current) connectRef.current();
      }, delay);
    };

    const run = async () => {
      try {
        const response = await streamFetch(`${API_BASE}/api/events/${eventId}/stream`, {
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

        // Stream established — reset retry counter/delay and announce "connected".
        retryCountRef.current = 0;
        retryDelayRef.current = INITIAL_BACKOFF_MS;
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
  }, [eventId, authToken, cancelRetry]);

  // Keep the ref current so the retry timer always calls the latest connect.
  connectRef.current = connect;

  // Open the stream on focus; close it (and cancel any pending retry) on blur.
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      retryCountRef.current = 0;
      retryDelayRef.current = INITIAL_BACKOFF_MS;
      connect();

      return () => {
        focusedRef.current = false;
        cancelRetry();
        abortRef.current?.abort();
        abortRef.current = null;
        setStatus("reconnecting");
      };
    }, [connect, cancelRetry]),
  );

  // Reconnect when the app returns from the background while this screen is
  // focused. Mobile OSes silently drop TCP connections after a few seconds in
  // the background, so the existing SSE stream is already dead by the time the
  // user opens the app again. Also cancel any pending retry when the app moves
  // to the background — the focus-restore path above will handle reconnection.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && focusedRef.current) {
        retryCountRef.current = 0;
        retryDelayRef.current = INITIAL_BACKOFF_MS;
        connect();
      } else if (nextState === "background") {
        cancelRetry();
        abortRef.current?.abort();
      }
    });
    return () => sub.remove();
  }, [connect, cancelRetry]);

  // Manual retry: reset the failure counter/back-off and reconnect immediately.
  // Used by the "Live updates unavailable" banner so the user can recover after
  // the automatic retries are exhausted.
  const retry = useCallback(() => {
    if (!focusedRef.current) focusedRef.current = true;
    retryCountRef.current = 0;
    retryDelayRef.current = INITIAL_BACKOFF_MS;
    connect();
  }, [connect]);

  return { status, retry };
}
