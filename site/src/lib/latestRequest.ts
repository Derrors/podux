import { isAbortError } from "./api";

/** Returned by LatestRequest.run when a newer request superseded this one (or it was aborted). */
export const STALE: unique symbol = Symbol("stale");

export interface LatestRequest {
  /**
   * Aborts the previous in-flight request and runs `fn`.
   * Resolves with STALE when the result is outdated, i.e. a newer `run` started
   * before this one finished, or the request was aborted. Real errors are rethrown.
   */
  run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T | typeof STALE>;
  /** Aborts the in-flight request and marks every pending result as stale. */
  abort(): void;
}

export function createLatestRequest(): LatestRequest {
  let current = 0;
  let controller: AbortController | null = null;

  return {
    async run(fn) {
      controller?.abort();
      const own = new AbortController();
      controller = own;
      const id = ++current;
      try {
        const value = await fn(own.signal);
        return id === current ? value : STALE;
      } catch (err) {
        if (id !== current || isAbortError(err)) return STALE;
        throw err;
      } finally {
        if (controller === own) controller = null;
      }
    },
    abort() {
      current++;
      controller?.abort();
      controller = null;
    },
  };
}
