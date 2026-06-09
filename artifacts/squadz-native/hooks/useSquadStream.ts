import { useCallback, useRef } from "react";
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
 * re-opened when it regains focus.
 */
export function useSquadStream({ squadId, authToken, onUpdate }: Options): void {
  const abortRef = useRef<AbortController | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useFocusEffect(
    useCallback(() => {
      if (!squadId) return;

      let cancelled = false;
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

          while (!cancelled) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // SSE messages are separated by blank lines (\n\n).
            // Split on blank lines and look for "event: update".
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
          // AbortError is expected on focus-loss — not a problem.
          if (err instanceof Error && err.name !== "AbortError") {
            // Network failure while focused. The 60 s fallback poll in the
            // screen will catch any missed updates until the next focus cycle
            // re-opens the stream.
          }
        }
      };

      void run();

      return () => {
        cancelled = true;
        controller.abort();
        abortRef.current = null;
      };
    }, [squadId, authToken]),
  );
}
