import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePaginatedList, type PageQuery, type PageResult } from "./usePaginatedList";

type Row = { id: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

function page(id: string, totalPages = 3): PageResult<Row> {
  return { items: [{ id }], totalPages, totalItems: totalPages };
}

/** fetchPage whose responses are resolved manually, in any order. */
function controllableFetch() {
  const calls: Array<{ query: PageQuery; resolve: (r: PageResult<Row>) => void }> = [];
  const fetchPage = vi.fn((query: PageQuery) => {
    const d = deferred<PageResult<Row>>();
    calls.push({ query, resolve: d.resolve });
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
