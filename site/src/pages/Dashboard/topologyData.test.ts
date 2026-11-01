import { describe, expect, it } from "vitest";
import { reconcileTopology, selectTopologyPage, TOPOLOGY_PAGE_SIZE } from "./topologyData";
import type { TopologyData } from "./useDashboard";

export function fixture(size = 10000): TopologyData {
  return {
    servers: [
      { id: "s1", serverName: "One", serverAddr: "example.com", bootStatus: "running" },
      { id: "s2", serverName: "Two", serverAddr: "other.example.com", bootStatus: "stopped" },
    ],
    proxies: Array.from({ length: size }, (_, i) => ({
      id: `p${i}`,
      serverId: "s1",
      name: `Proxy ${i}`,
      proxyType: "tcp",
      localIP: "127.0.0.1",
      localPort: 80,
      remotePort: 1000 + i,
      status: "enabled",
      bootStatus: "online",
    })),
    visitors: [
      {
        id: "v1",
        serverId: "s1",
        name: "Visitor",
        visitorType: "stcp",
        serverName: "remote",
        bindAddr: "127.0.0.1",
        bindPort: 0,
        status: "enabled",
      },
    ],
  };
}

describe("topology reconciliation and bounded selection", () => {
  it("reuses the full snapshot on an unchanged 10,000-proxy poll", () => {
    const old = fixture();
    expect(reconcileTopology(old, structuredClone(old))).toBe(old);
  });

  it("keeps unchanged arrays and records on a status change", () => {
    const old = fixture(10);
    const next = structuredClone(old);
    next.proxies[1].bootStatus = "offline";
    const merged = reconcileTopology(old, next);
    expect(merged.servers).toBe(old.servers);
    expect(merged.visitors).toBe(old.visitors);
    expect(merged.proxies[0]).toBe(old.proxies[0]);
    expect(merged.proxies[1].bootStatus).toBe("offline");
    expect(merged.proxies[1]).not.toBe(old.proxies[1]);
  });

  it("bounds every page, includes visitors across the page boundary and clamps deletion", () => {
    const data = fixture(TOPOLOGY_PAGE_SIZE + 1);
    const first = selectTopologyPage(data, "s1", 0, true);
    expect(first.topology.proxies).toHaveLength(TOPOLOGY_PAGE_SIZE);
    expect(first.topology.visitors).toHaveLength(0);
    const last = selectTopologyPage(data, "s1", 999, true);
    expect(last.currentPage).toBe(1);
    expect(last.topology.proxies).toHaveLength(1);
    expect(last.topology.visitors).toHaveLength(1);
    expect(selectTopologyPage(data, "s2", 999, true).currentPage).toBe(0);
    expect(selectTopologyPage(data, "deleted", 0, true).topology.servers[0].id).toBe("s1");
  });

  it("builds only server summaries until expanded and handles legacy null/missing lists", () => {
    const result = selectTopologyPage(fixture(), "s1", 0, false);
    expect(result.total).toBe(10001);
    expect(result.topology.proxies).toHaveLength(0);
    expect(result.topology.visitors).toHaveLength(0);
    expect(reconcileTopology(fixture(), {})).toEqual({ servers: [], proxies: [], visitors: [] });
  });
});
