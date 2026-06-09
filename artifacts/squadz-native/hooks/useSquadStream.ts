import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

type Options = {
  squadId: string | null;
  authToken: string | null;
  onUpdate: () => void;
};

/**
 * Opens a Server-Sent Events connection to /api/squads/:id/stream while the
 * screen is focused. When the server broadcasts an "update" event (squad was
 * mutated by another member), onUpdate() is called immediately.
 *
 * The connection is automatically closed when the screen loses focus and
 * re-opened when it regains focus. It is also torn down and re-established
 * whenever the app transitions from background → active (AppState "active"),
 * because mobile OSes silently kill background TCP connections.
 */
export function useSquadStream({ squadId, authToken, onUpdate }: Options): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const abortRef = useRef<AbortController | null>(null);
  // True while the squad-detail screen is in the Expo Router focus stack.
  const focusedRef = useRef(false);

  const connect = useCallback(() => {
    if (!squadId) return;

    // Tear down any existing connection before opening a new one.
    abortRef.current?.abort();

    const controller = new AbortController();
    abortRef.current = controller;

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

        if (!response.ok || !response.body) return;

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
      } catch (err) {
        // AbortError is expected when we intentionally close the connection.
        if (err instanceof Error && err.name !== "AbortError") {
          // Network failure while focused. The 60 s fallback poll in the
          // screen will catch any missed updates until the next reconnect.
        }
      }
    };

    void run();
  }, [squadId, authToken]);

  // Open the stream on focus; close it on blur.
  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      connect();

      return () => {
        focusedRef.current = false;
        abortRef.current?.abort();
        abortRef.current = null;
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
        connect();
      }
    });
    return () => sub.remove();
  }, [connect]);
}
