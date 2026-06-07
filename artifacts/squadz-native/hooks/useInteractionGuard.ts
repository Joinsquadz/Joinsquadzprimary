import { useRef, useCallback, useEffect } from "react";

/**
 * Shared guard that prevents background refreshes while any modal, sheet, or
 * interactive gesture is in progress.
 *
 * Usage:
 *   const { stamp, hold, release, isActive } = useInteractionGuard();
 *
 *   stamp()            – one-shot stamp (e.g. cell tap, button press)
 *   hold()             – start continuous re-stamping (call when a sheet opens)
 *   release()          – stop continuous re-stamping (call when a sheet closes)
 *   isActive(quietMs)  – true if a stamp occurred within the last `quietMs` ms
 */
export function useInteractionGuard() {
  const lastInteractionRef = useRef<number>(0);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stamp = useCallback(() => {
    lastInteractionRef.current = Date.now();
  }, []);

  const hold = useCallback(() => {
    lastInteractionRef.current = Date.now();
    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    holdIntervalRef.current = setInterval(() => {
      lastInteractionRef.current = Date.now();
    }, 1_000);
  }, []);

  const release = useCallback(() => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  }, []);

  const isActive = useCallback(
    (quietMs: number) => Date.now() - lastInteractionRef.current < quietMs,
    [],
  );

  // Clear the repeating interval on unmount so it never outlives the component.
  useEffect(() => () => { release(); }, [release]);

  return { stamp, hold, release, isActive };
}
