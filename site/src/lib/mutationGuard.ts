/**
 * Keeps polled data from overwriting optimistic updates.
 * A load takes a token with `begin()` and only applies its response when `isCurrent(token)`
 * is still true, i.e. no optimistic patch (`touch`) happened and no mutation (`run`) was
 * running or finished since the load started: such a response may predate the change.
 */
export interface MutationGuard {
  begin(): number;
  isCurrent(token: number): boolean;
  /** Marks an optimistic local change; responses of loads started before it become stale. */
  touch(): void;
  /** Runs a server update; overlapping loads are stale until it settled. */
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createMutationGuard(): MutationGuard {
  let version = 0;
  let pending = 0;

  return {
    begin: () => version,
    isCurrent: (token) => pending === 0 && token === version,
    touch() {
      version++;
    },
    async run(fn) {
      pending++;
      version++;
      try {
        return await fn();
      } finally {
        pending--;
        version++;
      }
    },
  };
}
