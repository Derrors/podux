import { vi } from "vitest";

/** Deterministic viewport changes for responsive component tests. */
export function mockViewport(initialWidth = 1440) {
  let width = initialWidth;
  const listeners = new Map<string, Set<(event: MediaQueryListEvent) => void>>();
  const matches = (query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    return (
      Boolean(max || min) && (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    );
  };
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return matches(query);
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      const current = listeners.get(query) ?? new Set();
      current.add(listener);
      listeners.set(query, current);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.get(query)?.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  }));
  return {
    setWidth(next: number) {
      width = next;
      for (const [query, callbacks] of listeners)
        for (const callback of callbacks)
          callback({ matches: matches(query), media: query } as MediaQueryListEvent);
    },
    get subscriptionCount() {
      return [...listeners.values()].reduce((total, callbacks) => total + callbacks.size, 0);
    },
  };
}
