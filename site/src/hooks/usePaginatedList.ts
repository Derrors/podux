import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from "react";
import { STALE } from "../lib/latestRequest";
import { createMutationGuard } from "../lib/mutationGuard";
import { useLatestRequest } from "./useLatestRequest";
import { usePolling } from "./usePolling";

export interface PageResult<T> {
  items: T[];
  totalPages: number;
  totalItems: number;
}

export interface PageQuery {
  page: number;
  perPage: number;
  search: string;
  signal: AbortSignal;
}

export interface UsePaginatedListOptions<R> {
  fetchPage: (query: PageQuery) => Promise<R>;
  /** Called for failed loads (not for aborted or superseded ones). */
  onError: (err: unknown) => void;
  perPage?: number;
  pollIntervalMs?: number;
  debounceMs?: number;
  /** External query identity (e.g. filters); changing it immediately starts again at page 1. */
  queryKey?: string;
}

/**
 * Paginated, searchable list with debounced search, polling and race-safety:
 * every load aborts the previous one, and responses that finish after a newer
 * request started (older page/search/filters, slow poll) are dropped.
 */
export function usePaginatedList<T, R extends PageResult<T> = PageResult<T>>({
  fetchPage,
  onError,
  perPage = 10,
  pollIntervalMs = 5000,
  debounceMs = 300,
  queryKey = "",
}: UsePaginatedListOptions<R>) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pagination, setPagination] = useState({ queryKey, page: 1, version: 0 });
  // Reset during render so a new key never starts a request using the old page.
  const queryChanged = pagination.queryKey !== queryKey;
  const queryVersion = pagination.version + (queryChanged ? 1 : 0);
  if (queryChanged) setPagination({ queryKey, page: 1, version: queryVersion });
  const page = queryChanged ? 1 : pagination.page;
  const setPage = useCallback(
    (update: SetStateAction<number>) => {
      setPagination((current) => {
        if (current.queryKey !== queryKey || current.version !== queryVersion) return current;
        return { ...current, page: typeof update === "function" ? update(current.page) : update };
      });
    },
    [queryKey, queryVersion]
  );
  // A failed load settles too, but must not relabel another query's rows as current.
  const [settled, setSettled] = useState<{ queryId: string; result: R | null } | null>(null);
  const result = settled?.result ?? null;
  // The version also distinguishes leaving and returning to the same external filters.
  const queryId = JSON.stringify([queryKey, queryVersion, page, perPage, debouncedSearch]);
  const visibleQueryId = JSON.stringify([queryKey, queryVersion, page, perPage, search]);
  const activeQuery = useRef(queryId);
  const [refreshing, setRefreshing] = useState(false);
  const request = useLatestRequest();
  const [mutations] = useState(createMutationGuard);

  const fetchPageRef = useRef(fetchPage);
  const onErrorRef = useRef(onError);
  useLayoutEffect(() => {
    fetchPageRef.current = fetchPage;
    onErrorRef.current = onError;
  });

  // Invalidate on commit, before passive effects start the replacement load.
  useLayoutEffect(() => {
    activeQuery.current = queryId;
    request.abort();
  }, [queryId, request]);

  // Debounce only the search input; external filters do not restart its timer.
  useEffect(() => {
    if (search === debouncedSearch) return;
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPagination((current) => ({ ...current, page: 1 }));
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch, debounceMs]);

  const load = useCallback(async () => {
    // An async action may still hold the reload callback from a previous query.
    if (activeQuery.current !== queryId) return;
    const query = { page, perPage, search: debouncedSearch };
    const fetch = fetchPageRef.current;
    const token = mutations.begin();
    let next: R | typeof STALE | undefined;
    try {
      next = await request.run((signal) => fetch({ ...query, signal }));
    } catch (err) {
      if (activeQuery.current === queryId && mutations.isCurrent(token)) onErrorRef.current(err);
    }
    if (next === STALE || activeQuery.current !== queryId) return;
    // The response may predate an optimistic change; the reload after the mutation settles it.
    if (!mutations.isCurrent(token)) return;
    setSettled((current) => ({
      queryId,
      result: next ?? (current?.queryId === queryId ? current.result : null),
    }));
    // Deleting the last row of the last page leaves us past the end.
    if (next && next.totalPages > 0 && query.page > next.totalPages) setPage(next.totalPages);
  }, [page, perPage, debouncedSearch, queryId, request, mutations, setPage]);

  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  usePolling(load, pollIntervalMs);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  /**
   * Optimistically patch the current result (e.g. toggling a status before the server confirms).
   * The in-flight load is aborted so an older response can't overwrite the patch.
   */
  const mutate = useCallback(
    (updater: (current: R) => R) => {
      if (activeQuery.current !== queryId) return;
      mutations.touch();
      request.abort();
      setSettled((current) =>
        current?.queryId === queryId && current.result
          ? { ...current, result: updater(current.result) }
          : current
      );
    },
    [mutations, request, queryId]
  );

  /**
   * Runs a server update (put the optimistic `mutate` before it and any rollback inside `fn`).
   * Loads overlapping it are dropped; the list is reloaded once it settled.
   */
  const runMutation = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T> => {
      request.abort();
      try {
        return await mutations.run(fn);
      } finally {
        void loadRef.current();
      }
    },
    [mutations, request]
  );

  return {
    items: result?.items ?? [],
    result,
    /** True until the first load settled. */
    initialLoading: settled === null,
    /** True while the rows belong to an older page, search or external query. */
    loading: settled === null || settled.queryId !== visibleQueryId,
    refreshing,
    page,
    setPage,
    totalPages: result?.totalPages ?? 1,
    totalItems: result?.totalItems ?? 0,
    search,
    setSearch,
    refresh,
    reload: load,
    mutate,
    runMutation,
  };
}
