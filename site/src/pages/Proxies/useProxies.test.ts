import PocketBase from "pocketbase";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PageResult } from "../../hooks/usePaginatedList";
import type { Proxy } from "../../types/proxy";
import { useProxies } from "./useProxies";

const mocks = vi.hoisted(() => ({
  getList: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  notifyError: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  t: (key: string) => key,
}));

vi.mock("../../lib/pocketbase", async () => {
  const { default: PocketBase } = await import("pocketbase");
  const pb = new PocketBase();
  return {
    default: {
      filter: pb.filter.bind(pb),
      collection: () => ({ getList: mocks.getList, update: mocks.update, delete: mocks.delete }),
    },
  };
});
vi.mock("../../lib/api", () => ({ apiGet: mocks.apiGet, apiPost: mocks.apiPost, isAbortError: () => false }));
vi.mock("../../lib/notify", () => ({ notifyError: mocks.notifyError }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock("../../hooks/useProxyStatus", () => ({ useProxyStatus: () => ({ statuses: {}, subdomainHosts: {} }) }));

type ListOptions = { filter?: string; signal: AbortSignal; sort?: string; expand?: string };

function seed(): Proxy[] {
  const rows: Proxy[] = Array.from({ length: 30 }, (_, index) => ({
    id: `background-${index + 1}`,
    name: `background-${index + 1}`,
    serverId: "server-a",
    proxyType: "udp",
    status: "enabled",
    bootStatus: "online",
    created: "2026-01-01",
    updated: "2026-01-01",
  }));
  const target = (index: number, id: string, patch: Partial<Proxy>) => {
    rows[index] = { ...rows[index], id, name: id, serverId: "server-b", proxyType: "tcp", ...patch };
  };
  // These matches live on pages 2 and 3 of the unfiltered list, not on page 1.
  target(11, "target-a", { bootStatus: "offline" });
  target(22, "target-b", { bootStatus: "offline" });
  // Runtime can remain online briefly after disabling; it must not count as globally online.
  target(23, "target-disabled", { status: "disabled", bootStatus: "online" });
  target(24, "target-online", {});
  target(25, "target-other-server", { serverId: "server-a", bootStatus: "offline" });
  target(26, "target-udp", { proxyType: "udp", bootStatus: "offline" });
  return rows;
}

let records: Proxy[];

/** Simulates PocketBase applying the filter before pagination (not after slicing a page). */
function fixturePage(page: number, perPage: number, { filter = "" }: ListOptions): PageResult<Proxy> {
  let rows = records;
  const search = /name ~ '([^']*)'/.exec(filter)?.[1];
  const server = /serverId = '([^']*)'/.exec(filter)?.[1];
  const type = /proxyType = '([^']*)'/.exec(filter)?.[1];
  if (search) rows = rows.filter((row) => [row.name, row.localIP, row.remotePort].some((value) => String(value ?? "").includes(search)));
  if (server) rows = rows.filter((row) => row.serverId === server);
  if (type) rows = rows.filter((row) => row.proxyType === type);
  if (filter.includes('status = "enabled"')) rows = rows.filter((row) => row.status === "enabled");
  if (filter.includes('status = "disabled"')) rows = rows.filter((row) => row.status === "disabled");
  if (filter.includes('bootStatus = "online"')) rows = rows.filter((row) => row.bootStatus === "online");
  if (filter.includes('bootStatus != "online"')) rows = rows.filter((row) => row.bootStatus !== "online");
  return {
    items: rows.slice((page - 1) * perPage, page * perPage),
    totalItems: rows.length,
    totalPages: Math.ceil(rows.length / perPage),
  };
}

const immediateList = (page: number, perPage: number, options: ListOptions) => Promise.resolve(fixturePage(page, perPage, options));
const mainCalls = () => mocks.getList.mock.calls.filter(([, perPage]) => perPage === 10);
const globalStats = { total: 30, online: 25, offline: 5 };

function controlledLists() {
  const requests: Array<{ page: number; options: ListOptions; resolve: (value: PageResult<Proxy>) => void }> = [];
  mocks.getList.mockImplementation((page: number, perPage: number, options: ListOptions) => {
    if (perPage !== 10) return immediateList(page, perPage, options);
    return new Promise<PageResult<Proxy>>((resolve) => requests.push({ page, options, resolve }));
  });
  const resolve = async (index: number) => {
    const request = requests[index];
    await act(async () => request.resolve(fixturePage(request.page, 10, request.options)));
  };
  return { requests, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  records = seed();
  mocks.getList.mockImplementation(immediateList);
  mocks.apiGet.mockResolvedValue([{ id: "server-a", serverName: "Server A" }, { id: "server-b", serverName: "Server B" }]);
  mocks.apiPost.mockResolvedValue({});
  mocks.update.mockResolvedValue({});
  mocks.delete.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("useProxies filters", () => {
  it("returns the agreed default props and unfiltered totals", async () => {
    const { result } = renderHook(useProxies);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.filters).toEqual({ serverId: "all", type: "all", state: "all" });
    expect(result.current.hasFilters).toBe(false);
    expect(result.current.totalItems).toBe(30);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.proxies).toHaveLength(10);
    expect(result.current.stats).toEqual(globalStats);
    expect(mocks.getList).toHaveBeenCalledTimes(2);
    expect(mocks.apiGet).toHaveBeenCalledWith("/api/servers/options");
  });

  it("filters the complete query across pages, combines search with AND and keeps stats global", async () => {
    const { result } = renderHook(useProxies);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setPage(3));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.page).toBe(3);

    act(() => result.current.setFilter("serverId", "server-b"));
    expect(result.current.page).toBe(1);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalItems).toBe(5);
    expect(result.current.proxies.map((row) => row.id)).toEqual([
      "target-a", "target-b", "target-disabled", "target-online", "target-udp",
    ]);
    expect(mainCalls().at(-1)).toMatchObject([1, 10, { filter: "(serverId = 'server-b')" }]);

    act(() => result.current.setFilter("type", "tcp"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalItems).toBe(4);
    act(() => result.current.setFilter("state", "offline"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalItems).toBe(2);
    expect(result.current.proxies.map((row) => row.id)).toEqual(["target-a", "target-b"]);

    act(() => result.current.setSearch("target"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mainCalls().at(-1)).toMatchObject([1, 10, {
      filter: "(name ~ 'target' || localIP ~ 'target' || remotePort ~ 'target')" +
        " && (serverId = 'server-b') && (proxyType = 'tcp')" +
        ' && (status = "enabled" && bootStatus != "online")',
      sort: "-created",
      expand: "serverId",
    }]);
    expect(result.current.stats).toEqual(globalStats);
    expect(result.current.hasFilters).toBe(true);
    const lastThree = mocks.getList.mock.calls.slice(-3);
    expect(lastThree[1]).toMatchObject([1, 1, { filter: 'status = "enabled" && bootStatus = "online"' }]);
    expect(lastThree[2][2].filter).toBeUndefined();
    expect(lastThree[0][2].signal).toBe(lastThree[1][2].signal);
    expect(lastThree[0][2].signal).toBe(lastThree[2][2].signal);

    act(() => result.current.resetFilters());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.filters).toEqual({ serverId: "all", type: "all", state: "all" });
    expect(result.current.hasFilters).toBe(false);
    expect(result.current.search).toBe("target");
    expect(result.current.totalItems).toBe(6);
    expect(result.current.stats).toEqual(globalStats);
  });

  it("counts disabled proxies with stale online runtime as non-online even under filters and search", async () => {
    expect(records.filter((row) => row.bootStatus === "online")).toHaveLength(26);
    const { result } = renderHook(useProxies);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stats).toEqual({ total: 30, online: 25, offline: 5 });
    expect(mocks.getList).toHaveBeenCalledWith(1, 1, {
      filter: 'status = "enabled" && bootStatus = "online"',
      signal: expect.any(AbortSignal),
    });

    act(() => {
      result.current.setFilter("state", "disabled");
      result.current.setSearch("target-disabled");
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalItems).toBe(1);
    expect(result.current.proxies).toMatchObject([
      { id: "target-disabled", status: "disabled", bootStatus: "online" },
    ]);
    expect(result.current.stats).toEqual(globalStats);

    act(() => result.current.setFilter("state", "online"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.proxies).toEqual([]);
    expect(result.current.totalItems).toBe(0);
    expect(result.current.stats).toEqual(globalStats);
  });

  it.each([
    ["online", 25],
    ["offline", 4],
    ["disabled", 1],
  ])("queries the %s state with independent global counts", async (state, totalItems) => {
    const { result } = renderHook(useProxies);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setFilter("state", state));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalItems).toBe(totalItems);
    expect(result.current.stats).toEqual(globalStats);
    if (state === "disabled") expect(result.current.proxies.map((row) => row.id)).toEqual(["target-disabled"]);
    if (state === "offline") expect(result.current.proxies.every((row) => row.status === "enabled" && row.bootStatus !== "online")).toBe(true);
  });

  it("normalizes unsupported filter values and treats a missing server as an empty result", async () => {
    const { result } = renderHook(useProxies);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setFilter("type", "tcp"));
    await waitFor(() => expect(result.current.totalItems).toBe(5));
    act(() => {
      result.current.setFilter("type", "unknown-protocol");
      result.current.setFilter("state", "unknown-state");
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.filters).toEqual({ serverId: "all", type: "all", state: "all" });
    expect(result.current.hasFilters).toBe(false);
    expect(result.current.totalItems).toBe(30);
    act(() => result.current.setFilter("serverId", "missing-server"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.proxies).toEqual([]);
    expect(result.current.totalItems).toBe(0);
    expect(result.current.stats).toEqual(globalStats);
  });

  it("does not allow late pages or earlier filters to overwrite the current query", async () => {
    const { requests, resolve } = controlledLists();
    const { result } = renderHook(useProxies);
    await waitFor(() => expect(requests).toHaveLength(1));
    await resolve(0);
    act(() => result.current.setPage(3));
    await waitFor(() => expect(requests).toHaveLength(2));
    act(() => result.current.setFilter("serverId", "server-b"));
    await waitFor(() => expect(requests).toHaveLength(3));
    act(() => result.current.setFilter("type", "tcp"));
    await waitFor(() => expect(requests).toHaveLength(4));
    act(() => result.current.setFilter("state", "offline"));
    await waitFor(() => expect(requests).toHaveLength(5));
    expect(result.current.page).toBe(1);
    expect(requests.slice(1, 4).every((request) => request.options.signal.aborted)).toBe(true);
    await resolve(4);
    await resolve(3);
    await resolve(2);
    await resolve(1);
    expect(result.current.proxies.map((row) => row.id)).toEqual(["target-a", "target-b"]);
    expect(result.current.totalItems).toBe(2);
    expect(result.current.stats).toEqual(globalStats);
    expect(result.current.loading).toBe(false);
  });

  it("keeps search input safely parameterized when combined with filters", async () => {
    const { result } = renderHook(useProxies);
    await waitFor(() => expect(result.current.loading).toBe(false));
    const search = "' || status = 'disabled";
    act(() => {
      result.current.setFilter("serverId", "server-b");
      result.current.setSearch(search);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const pb = new PocketBase();
    expect(mainCalls().at(-1)?.[2].filter).toBe(
      `(${pb.filter("name ~ {:q} || localIP ~ {:q} || remotePort ~ {:q}", { q: search })}) && (serverId = 'server-b')`
    );
  });
});

describe("useProxies selection boundaries", () => {
  it("clears selection for every page/search/filter transition and never resurrects it", async () => {
    const { result } = renderHook(useProxies);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.selectPage(true));
    expect(result.current.selected.size).toBe(10);
    act(() => result.current.setPage(2));
    expect(result.current.selected.size).toBe(0);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setPage(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selected.size).toBe(0);

    for (const [key, value] of [["serverId", "server-b"], ["type", "tcp"], ["state", "offline"]] as const) {
      act(() => result.current.selectPage(true));
      expect(result.current.selected.size).toBeGreaterThan(0);
      act(() => result.current.setFilter(key, value));
      expect(result.current.selected.size).toBe(0);
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.selected.size).toBe(0);
    }
    act(() => result.current.selectPage(true));
    act(() => result.current.setSearch("target"));
    expect(result.current.selected.size).toBe(0);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.resetFilters());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selected.size).toBe(0);
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it("blocks selection on stale rows and old callbacks, and batches only the new filter's IDs", async () => {
    const { requests, resolve } = controlledLists();
    const { result } = renderHook(useProxies);
    await waitFor(() => expect(requests).toHaveLength(1));
    await resolve(0);
    act(() => result.current.selectPage(true));
    const oldBatch = result.current.runBatch;
    const oldSelectPage = result.current.selectPage;
    const oldToggle = result.current.toggleSelected;
    act(() => result.current.setFilter("serverId", "server-b"));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(result.current.selected.size).toBe(0);
    act(() => {
      result.current.selectPage(true);
      result.current.toggleSelected("background-1");
      oldSelectPage(true);
      oldToggle("background-1");
    });
    await act(async () => {
      await oldBatch("delete");
      await result.current.runBatch("delete");
    });
    expect(mocks.apiPost).not.toHaveBeenCalled();
    expect(result.current.selected.size).toBe(0);
    await resolve(1);
    mocks.getList.mockImplementation(immediateList);
    act(() => result.current.selectPage(true));
    expect(result.current.selected.size).toBe(5);
    await act(async () => oldBatch("delete"));
    expect(mocks.apiPost).not.toHaveBeenCalled();
    expect(result.current.selected.size).toBe(5);
    await act(async () => result.current.runBatch("disable"));
    expect(mocks.apiPost).toHaveBeenCalledWith("/api/proxies/batch", {
      ids: ["target-a", "target-b", "target-disabled", "target-online", "target-udp"],
      action: "disable",
      serverId: undefined,
    });
    expect(result.current.selected.size).toBe(0);
    expect(result.current.batchBusy).toBe(false);
  });

  it("does not revive old selection callbacks after leaving and returning to the same filters", async () => {
    const { result } = renderHook(useProxies);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.toggleSelected("background-1"));
    const { runBatch: oldBatch, toggleSelected: oldToggle, selectPage: oldSelectPage } = result.current;
    act(() => result.current.setFilter("serverId", "server-b"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.resetFilters());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.selected.size).toBe(0);
    act(() => result.current.toggleSelected("background-2"));
    act(() => {
      oldToggle("background-1");
      oldSelectPage(true);
    });
    await act(async () => oldBatch("delete"));
    expect([...result.current.selected]).toEqual(["background-2"]);
    expect(mocks.apiPost).not.toHaveBeenCalled();
    await act(async () => result.current.runBatch("disable"));
    expect(mocks.apiPost).toHaveBeenCalledWith("/api/proxies/batch", {
      ids: ["background-2"], action: "disable", serverId: undefined,
    });
  });

  it("excludes IDs removed from the current page by a reload, even for a retained batch callback", async () => {
    const { result } = renderHook(useProxies);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => {
      result.current.toggleSelected("background-1");
      result.current.toggleSelected("background-2");
      result.current.toggleSelected("not-on-this-page");
    });
    expect([...result.current.selected]).toEqual(["background-1", "background-2"]);
    const retainedBatch = result.current.runBatch;
    records = records.filter((row) => row.id !== "background-1");
    await act(async () => result.current.refreshProxies());
    expect([...result.current.selected]).toEqual(["background-2"]);
    await act(async () => retainedBatch("delete"));
    expect(mocks.apiPost).toHaveBeenCalledWith("/api/proxies/batch", {
      ids: ["background-2"], action: "delete", serverId: undefined,
    });
  });
});
