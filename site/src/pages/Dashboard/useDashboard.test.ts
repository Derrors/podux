import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../../lib/api";
import { useDashboard } from "./useDashboard";

vi.mock("../../lib/notify", () => ({ notifyError: vi.fn() }));

const stats = {
  proxiesEnabledCount: 12,
  proxiesDisabledCount: 1,
  runningCount: 2,
  stoppedCount: 0,
};
const topology = {
  servers: [{ id: "s", serverName: "Server", serverAddr: "example.com", bootStatus: "running" }],
  proxies: [],
  visitors: [],
};

beforeEach(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("independent dashboard requests", () => {
  it("renders stats while topology is pending, and continues stats polling", async () => {
    vi.useFakeTimers();
    const get = vi
      .spyOn(api, "apiGet")
      .mockImplementation((path) =>
        path.endsWith("stats") ? Promise.resolve(stats) : new Promise(() => undefined)
      );
    const { result, unmount } = renderHook(() => useDashboard());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.stats.totalProxies).toBe(13);
    expect(result.current.statsLoading).toBe(false);
    expect(result.current.topologyLoading).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(get.mock.calls.filter(([path]) => path.endsWith("stats"))).toHaveLength(3);
    expect(get.mock.calls.filter(([path]) => path.endsWith("topology"))).toHaveLength(1);
    const pendingSignal = get.mock.calls.find(([path]) => path.endsWith("topology"))?.[1]?.signal;
    unmount();
    expect(pendingSignal?.aborted).toBe(true);
  });

  it("retains successful topology when stats fail and permits independent retry", async () => {
    const get = vi
      .spyOn(api, "apiGet")
      .mockImplementation((path) =>
        path.endsWith("stats")
          ? Promise.reject(new Error("stats unavailable"))
          : Promise.resolve(topology)
      );
    const { result } = renderHook(() => useDashboard());
    await waitFor(() => expect(result.current.statsFailed).toBe(true));
    expect(result.current.topology.servers).toHaveLength(1);
    expect(result.current.topologyFailed).toBe(false);
    get.mockResolvedValue(stats);
    await act(() => result.current.loadStats());
    expect(result.current.statsFailed).toBe(false);
    expect(result.current.topology.servers).toHaveLength(1);
  });

  it("keeps the previous snapshot on a failed topology refresh and ignores stale responses", async () => {
    const get = vi
      .spyOn(api, "apiGet")
      .mockImplementation((path) => Promise.resolve(path.endsWith("stats") ? stats : topology));
    const { result } = renderHook(() => useDashboard());
    await waitFor(() => expect(result.current.topologyLoading).toBe(false));
    const previous = result.current.topology;
    get.mockResolvedValue(structuredClone(topology));
    await act(() => result.current.loadTopology());
    expect(result.current.topology).toBe(previous);
    get.mockRejectedValue(new Error("topology unavailable"));
    await act(() => result.current.loadTopology());
    expect(result.current.topologyFailed).toBe(true);
    expect(result.current.topology).toBe(previous);

    let resolveOld!: (value: typeof topology) => void;
    get
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          })
      )
      .mockResolvedValueOnce({ servers: [], proxies: [], visitors: [] });
    const old = result.current.loadTopology();
    await act(() => result.current.loadTopology());
    await act(async () => {
      resolveOld(topology);
      await old;
    });
    expect(result.current.topology.servers).toHaveLength(0);
  });
});
