import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
// Expo's streaming-capable fetch. React Native's built-in fetch does NOT
// populate `response.body` (it has no ReadableStream), so the SSE reader below
// could never start on a device. expo/fetch returns a real streaming body on
// both native and web.
import { fetch as streamFetch } from "expo/fetch";
import { API_BASE, buildAuthHeaders } from "@/lib/api";

type Options = {
  photoId: number | null;
  authToken: string | null;
  onUpdate: () => void;
};

/**
 * Opens a Server-Sent Events connection to /api/vault/photos/:id/stream while a
 * vault media detail view is open. When the server broadcasts an "update" event
 * (a heart toggled, a comment added/removed, the caption edited), onUpdate() is
 * called immediately so the detail view can re-fetch hearts/comments/caption.
 *
 * The connection is torn down when `photoId` becomes null (detail closed) and
 * re-established when the app returns from the background, because mobile OSes
 * silently kill background TCP connections. A 20 s poll in the consumer covers
 * any window where the stream is unavailable (built-in fetch has no body, etc.).
 */
export function useVaultPhotoStream({ photoId, authToken, onUpdate }: Options): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const abortRef = useRef<AbortController | null>(null);
  const openRef = useRef(false);

  const connect = useCallback(() => {
    if (!photoId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const run = async () => {
      try {
        const response = await streamFetch(`${API_BASE}/api/vault/photos/${photoId}/stream`, {
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
        // Any other failure is covered by the consumer's fallback poll.
        if (err instanceof Error && err.name !== "AbortError") {
          // no-op
        }
      }
    };

    void run();
  }, [photoId, authToken]);

  // Open the stream while a photo is selected; close it when it clears.
  useEffect(() => {
    if (!photoId) {
      openRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    openRef.current = true;
    connect();
    return () => {
      openRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [photoId, connect]);

  // Reconnect when the app returns from the background while a photo is open.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" && openRef.current) {
        connect();
      }
    });
    return () => sub.remove();
  }, [connect]);
}
