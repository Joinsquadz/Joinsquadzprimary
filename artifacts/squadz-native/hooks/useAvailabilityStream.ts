import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { fetch as streamFetch } from "expo/fetch";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

export type AvailabilityStreamStatus = "connected" | "reconnecting" | "error";

type Options = {
  pollId: string | null;
  authToken: string | null;
  onUpdate: () => void;
};

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_RETRIES = 10;

/**
 * Opens a Server-Sent Events connection to /api/availability/polls/:id/stream
 * while the availability screen is focused. When the server broadcasts an
 * "update" event (a member submitted, the host changed the range, or the host
 * nudged someone), onUpdate() is called immediately.
 *
 * The connection is opened on focus, closed on blur, and re-established when the
 * app returns from the background (mobile OSes silently kill background TCP
 * connections). Network errors trigger exponential-backoff retries (1 s → 2 s …
 * capped at 30 s), resetting on a successful reconnect.
 *
 * This is a best-effort live layer — callers keep their existing polling
 * fallback so the screen still updates if the stream can't be established.
 */
export function useAvailabilityStream({ pollId, authToken, onUpdate }: Options): { status: AvailabilityStreamStatus; retry: () => void } {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const abortRef = useRef<AbortController | null>(null);
  const focusedRef = useRef(false);
  const retryDelayRef = useRef(INITIAL_BACKOFF_MS);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<AvailabilityStreamStatus>("reconnecting");

  const connectRef = useRef<() => void>(() => {});

  const cancelRetry = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!pollId) return;

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

      const delay = retryDelayRef.current;
      retryDelayRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        if (focusedRef.current) connectRef.current();
      }, delay);
    };

    const run = async () => {
      try {
        const response = await streamFetch(`${API_BASE}/api/availability/polls/${pollId}/stream`, {
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
  }, [pollId, authToken, cancelRetry]);

  connectRef.current = connect;

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

  const retry = useCallback(() => {
    if (!focusedRef.current) focusedRef.current = true;
    retryCountRef.current = 0;
    retryDelayRef.current = INITIAL_BACKOFF_MS;
    connect();
  }, [connect]);

  return { status, retry };
}
