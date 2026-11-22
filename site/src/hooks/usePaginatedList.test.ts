import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePaginatedList, type PageQuery, type PageResult } from "./usePaginatedList";

type Row = { id: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function page(id: string, totalPages = 3): PageResult<Row> {
  return { items: [{ id }], totalPages, totalItems: totalPages };
}

/** fetchPage whose responses are resolved manually, in any order. */
function controllableFetch() {
  const calls: Array<{
    query: PageQuery;
    resolve: (r: PageResult<Row>) => void;
    reject: (reason: unknown) => void;
  }> = [];
  const fetchPage = vi.fn((query: PageQuery) => {
    const d = deferred<PageResult<Row>>();
    calls.push({ query, resolve: d.resolve, reject: d.reject });
    return d.promise;
  });
  return { fetchPage, calls };
}

const options = { onError: () => undefined, pollIntervalMs: 60_000, debounceMs: 10 };

describe("usePaginatedList", () => {
  it("ignores an older page that resolves after a newer one", async () => {
    const { fetchPage, calls } = controllableFetch();
    const { result } = renderHook(() => usePaginatedList<Row>({ fetchPage, ...options }));

    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].query.signal.aborted).toBe(true);
    expect(calls[1].query.page).toBe(2);

    await act(async () => calls[1].resolve(page("page-2")));
    await act(async () => calls[0].resolve(page("page-1")));

    expect(result.current.items).toEqual([{ id: "page-2" }]);
    expect(result.current.page).toBe(2);
  });

  it("debounces the search, resets to page 1 and drops results of the old search", async () => {
    const { fetchPage, calls } = controllableFetch();
    const { result } = renderHook(() => usePaginatedList<Row>({ fetchPage, ...options }));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0].resolve(page("all")));

    act(() => result.current.setPage(3));
    await waitFor(() => expect(calls).toHaveLength(2));

    act(() => result.current.setSearch("w"));
    act(() => result.current.setSearch("we"));
    act(() => result.current.setSearch("web"));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].query).toMatchObject({ page: 1, search: "web" });
    expect(result.current.page).toBe(1);

    await act(async () => calls[2].resolve(page("web")));
    await act(async () => calls[1].resolve(page("page-3-unfiltered")));

    expect(result.current.items).toEqual([{ id: "web" }]);
    expect(result.current.loading).toBe(false);
  });

  it("reports real errors but not superseded ones", async () => {
    const onError = vi.fn();
    let call = 0;
    const fetchPage = vi.fn(async () => {
      call++;
      throw new Error(`fail ${call}`);
    });
    const { result } = renderHook(() =>
      usePaginatedList<Row>({ ...options, fetchPage, onError })
    );
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0][0]).toMatchObject({ message: "fail 1" });
    expect(result.current.initialLoading).toBe(false);
  });

  it("mutate makes an in-flight (poll) response stale", async () => {
    const { fetchPage, calls } = controllableFetch();
    const { result } = renderHook(() => usePaginatedList<Row>({ fetchPage, ...options }));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0].resolve(page("before")));

    // A poll/reload is in flight when the user toggles something.
    act(() => void result.current.reload());
    await waitFor(() => expect(calls).toHaveLength(2));
    act(() => result.current.mutate((r) => ({ ...r, items: [{ id: "optimistic" }] })));
    expect(calls[1].query.signal.aborted).toBe(true);

    await act(async () => calls[1].resolve(page("before")));
    expect(result.current.items).toEqual([{ id: "optimistic" }]);
  });

  it("runMutation drops loads that overlap the update and reloads afterwards", async () => {
    const { fetchPage, calls } = controllableFetch();
    const { result } = renderHook(() => usePaginatedList<Row>({ fetchPage, ...options }));
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0].resolve(page("before")));

    const update = deferred<void>();
    act(() => result.current.mutate((r) => ({ ...r, items: [{ id: "optimistic" }] })));
    let mutation!: Promise<void>;
    act(() => {
      mutation = result.current.runMutation(() => update.promise);
    });

    // A poll that starts and finishes while the update is pending is ignored.
    act(() => void result.current.reload());
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => calls[1].resolve(page("before")));
    expect(result.current.items).toEqual([{ id: "optimistic" }]);

    await act(async () => {
      update.resolve();
      await mutation;
    });
    await waitFor(() => expect(calls).toHaveLength(3));
    await act(async () => calls[2].resolve(page("confirmed")));
    expect(result.current.items).toEqual([{ id: "confirmed" }]);
  });

  it("resets an external query immediately, aborts an old page and keeps stale rows loading", async () => {
    const { fetchPage, calls } = controllableFetch();
    const { result, rerender } = renderHook(
      ({ queryKey }) => usePaginatedList<Row>({ fetchPage, queryKey, ...options }),
      { initialProps: { queryKey: "server-a" } }
    );
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0].resolve(page("server-a-page-1")));
    const oldReload = result.current.reload;

    act(() => result.current.setPage(3));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(result.current.loading).toBe(true);
    rerender({ queryKey: "server-b" });
    expect(result.current.page).toBe(1);
    expect(result.current.loading).toBe(true);
    expect(result.current.initialLoading).toBe(false);
    expect(calls[1].query.signal.aborted).toBe(true);
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].query).toMatchObject({ page: 1, search: "" });

    // Old callbacks and late results must not launch or relabel the new query.
    await act(async () => oldReload());
    expect(calls).toHaveLength(3);
    await act(async () => calls[1].resolve(page("late-server-a-page-3")));
    expect(result.current.items).toEqual([{ id: "server-a-page-1" }]);
    expect(result.current.loading).toBe(true);
    await act(async () => calls[2].resolve({ ...page("server-b-page-1"), totalItems: 21 }));
    expect(result.current.items).toEqual([{ id: "server-b-page-1" }]);
    expect(result.current.totalItems).toBe(21);
    expect(result.current.loading).toBe(false);
  });

  it("treats returning to the same filters as a new query, not as settled cached rows", async () => {
    const { fetchPage, calls } = controllableFetch();
    const { result, rerender } = renderHook(
      ({ queryKey }) => usePaginatedList<Row>({ ...options, fetchPage, queryKey }),
      { initialProps: { queryKey: "all" } }
    );
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0].resolve(page("original-all")));
    const { reload: oldReload, mutate: oldMutate, setPage: oldSetPage } = result.current;
    rerender({ queryKey: "tcp" });
    await waitFor(() => expect(calls).toHaveLength(2));
    rerender({ queryKey: "all" });
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(result.current.loading).toBe(true);
    expect(calls[1].query.signal.aborted).toBe(true);
    act(() => {
      oldSetPage(2);
      oldMutate((current) => ({ ...current, items: [{ id: "old patch" }] }));
    });
    await act(async () => oldReload());
    expect(result.current.page).toBe(1);
    expect(calls).toHaveLength(3);
    expect(calls[2].query.signal.aborted).toBe(false);
    await act(async () => calls[2].resolve(page("new-all")));
    await act(async () => calls[1].resolve(page("late-tcp")));
    expect(result.current.items).toEqual([{ id: "new-all" }]);
    expect(result.current.loading).toBe(false);
  });

  it("drops old external-query responses and errors even when they finish last", async () => {
    const { fetchPage, calls } = controllableFetch();
    const onError = vi.fn();
    const { result, rerender } = renderHook(
      ({ queryKey }) => usePaginatedList<Row>({ ...options, fetchPage, queryKey, onError }),
      { initialProps: { queryKey: "all" } }
    );
    await waitFor(() => expect(calls).toHaveLength(1));
    rerender({ queryKey: "tcp" });
    await waitFor(() => expect(calls).toHaveLength(2));
    rerender({ queryKey: "udp" });
    await waitFor(() => expect(calls).toHaveLength(3));
    await act(async () => calls[2].resolve(page("udp")));
    await act(async () => calls[1].reject(new Error("old tcp query")));
    await act(async () => calls[0].resolve(page("all")));
    expect(result.current.items).toEqual([{ id: "udp" }]);
    expect(result.current.loading).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("settles a failed new query without exposing the previous query's rows as current", async () => {
    const { fetchPage, calls } = controllableFetch();
    const onError = vi.fn();
    const { result, rerender } = renderHook(
      ({ queryKey }) => usePaginatedList<Row>({ ...options, fetchPage, queryKey, onError }),
      { initialProps: { queryKey: "all" } }
    );
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0].resolve(page("all")));
    rerender({ queryKey: "disabled" });
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => calls[1].reject(new Error("new query failed")));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.items).toEqual([]);
    expect(result.current.totalItems).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it("switches filters without cancelling or bypassing the pending search debounce", async () => {
    const { fetchPage, calls } = controllableFetch();
    const { result, rerender } = renderHook(
      ({ queryKey }) => usePaginatedList<Row>({ ...options, debounceMs: 100, fetchPage, queryKey }),
      { initialProps: { queryKey: "all" } }
    );
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0].resolve(page("all")));
    act(() => result.current.setSearch("web"));
    rerender({ queryKey: "http" });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].query).toMatchObject({ page: 1, search: "" });
    await act(async () => calls[1].resolve(page("all-http")));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].query).toMatchObject({ page: 1, search: "web" });
    await act(async () => calls[2].resolve(page("web-http")));
    expect(result.current.loading).toBe(false);
  });

  it("reloads the latest external query after a mutation and ignores its overlapping loads", async () => {
    const { fetchPage, calls } = controllableFetch();
    const { result, rerender } = renderHook(
      ({ queryKey }) => usePaginatedList<Row>({ ...options, fetchPage, queryKey }),
      { initialProps: { queryKey: "all" } }
    );
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0].resolve(page("before")));
    const oldMutate = result.current.mutate;
    const update = deferred<void>();
    let mutation!: Promise<void>;
    act(() => {
      mutation = result.current.runMutation(() => update.promise);
    });
    rerender({ queryKey: "enabled" });
    await waitFor(() => expect(calls).toHaveLength(2));
    act(() => oldMutate((current) => ({ ...current, items: [{ id: "old rollback" }] })));
    expect(calls[1].query.signal.aborted).toBe(false);
    await act(async () => calls[1].resolve(page("overlapping")));
    expect(result.current.loading).toBe(true);
    await act(async () => {
      update.resolve();
      await mutation;
    });
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].query.page).toBe(1);
    await act(async () => calls[2].resolve(page("confirmed")));
    expect(result.current.items).toEqual([{ id: "confirmed" }]);
    expect(result.current.loading).toBe(false);
  });

  it("clamps the page when it is past the last page", async () => {
    const { fetchPage, calls } = controllableFetch();
    const { result } = renderHook(() => usePaginatedList<Row>({ fetchPage, ...options }));
    await waitFor(() => expect(calls).toHaveLength(1));
    act(() => result.current.setPage(3));
    await waitFor(() => expect(calls).toHaveLength(2));
    await act(async () => calls[1].resolve(page("last", 2)));
    expect(result.current.page).toBe(2);
  });
});
