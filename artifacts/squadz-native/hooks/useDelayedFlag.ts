import { useEffect, useRef, useState } from "react";

/**
 * Returns true only after `active` has stayed continuously true for `delayMs`.
 * Resets to false immediately whenever `active` becomes false.
 *
 * Used to debounce the "Reconnecting…" indicator: a brief connection blip that
 * recovers within the delay never surfaces any UI — the indicator only appears
 * if the stream is still down after the grace period.
 */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (active) {
      timerRef.current = setTimeout(() => {
        setElapsed(true);
        timerRef.current = null;
      }, delayMs);
    } else {
      setElapsed(false);
    }
    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [active, delayMs]);

  return active && elapsed;
}
