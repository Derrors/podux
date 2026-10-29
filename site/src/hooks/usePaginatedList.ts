import { useCallback, useEffect, useRef, useState } from "react";
import { STALE } from "../lib/latestRequest";
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
}

/**
 * Paginated, searchable list with debounced search, polling and race-safety:
 * every load aborts the previous one, and responses that finish after a newer
 * request started (older page/search, slow poll) are dropped.
 */
export function usePaginatedList<T, R extends PageResult<T> = PageResult<T>>({
  fetchPage,
  onError,
  perPage = 10,
  pollIntervalMs = 5000,
  debounceMs = 300,
}: UsePaginatedListOptions<R>) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<R | null>(null);
  // Search term of the last settled load; null until the first load settled.
  const [loadedSearch, setLoadedSearch] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const request = useLatestRequest();

  const fetchPageRef = useRef(fetchPage);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    fetchPageRef.current = fetchPage;
    onErrorRef.current = onError;
  });

  // Debounce the search input; a new search always starts from page 1.
  useEffect(() => {
    if (search === debouncedSearch) return;
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch, debounceMs]);

  const load = useCallback(async () => {
    const query = { page, perPage, search: debouncedSearch };
    let next: R | typeof STALE | undefined;
    try {
      next = await request.run((signal) => fetchPageRef.current({ ...query, signal }));
    } catch (err) {
      onErrorRef.current(err);
    }
    if (next === STALE) return;
    if (next) {
      setResult(next);
      // Deleting the last row of the last page leaves us past the end.
      if (next.totalPages > 0 && query.page > next.totalPages) setPage(next.totalPages);
    }
    setLoadedSearch(query.search);
  }, [page, perPage, debouncedSearch, request]);

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

  /** Optimistically patch the current result (e.g. toggling a status before the server confirms). */
  const mutate = useCallback((updater: (current: R) => R) => {
    setResult((current) => (current ? updater(current) : current));
  }, []);

  return {
    items: result?.items ?? [],
    result,
    /** True until the first load settled. */
    initialLoading: loadedSearch === null,
    /** True while the visible rows don't match the search box yet (first load or a new search). */
    loading: loadedSearch === null || loadedSearch !== search,
    refreshing,
    page,
    setPage,
    totalPages: result?.totalPages ?? 1,
    search,
    setSearch,
    refresh,
    reload: load,
    mutate,
  };
}
