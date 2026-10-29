import { useEffect, useRef } from "react";

export interface UsePollingOptions {
  /** Run the callback once right away (default: false; the caller usually fetches on its own). */
  immediate?: boolean;
  /** Set to false to stop polling. */
  enabled?: boolean;
  /** Changing this restarts polling (with an immediate tick when `immediate` is set), e.g. a resource id. */
  restartKey?: unknown;
}

/**
 * Calls `callback` every `intervalMs`.
 * - The next tick is only scheduled after the previous one settled, so ticks never overlap.
 * - Pauses while the document is hidden and runs one tick as soon as it becomes visible again.
 * - Always uses the latest `callback` without restarting the timer.
 * Errors thrown by the callback are swallowed; the callback owns its error reporting.
 */
export function usePolling(
  callback: () => unknown,
  intervalMs: number,
  { immediate = false, enabled = true, restartKey }: UsePollingOptions = {}
) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    let disposed = false;

    const isHidden = () => document.visibilityState === "hidden";

    const schedule = () => {
      clearTimeout(timer);
      if (disposed || isHidden()) return;
      timer = setTimeout(tick, intervalMs);
    };

    const tick = async () => {
      if (inFlight || disposed) return;
      inFlight = true;
      clearTimeout(timer);
      try {
        await callbackRef.current();
      } catch {
        // Reporting is up to the callback; keep polling.
      } finally {
        inFlight = false;
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (isHidden()) {
        clearTimeout(timer);
      } else if (!inFlight) {
        void tick();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    if (immediate && !isHidden()) {
      void tick();
    } else {
      schedule();
    }

    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [intervalMs, enabled, immediate, restartKey]);
}
