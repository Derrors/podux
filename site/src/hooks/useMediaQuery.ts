import { useCallback, useSyncExternalStore } from "react";

/** Viewport-based layouts, with a stable desktop fallback during SSR and tests. */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    [query]
  );
  const getSnapshot = useCallback(
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    [query]
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
