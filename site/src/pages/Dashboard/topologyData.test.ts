import { describe, expect, it } from "vitest";
import { groupTopology, reconcileTopology } from "./topologyData";
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

describe("topology reconciliation and complete grouping", () => {
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

  it("keeps every server, proxy and visitor in stable order without a page limit", () => {
    const data = fixture();
    const groups = groupTopology(data);
    expect(groups.map(({ server }) => server.id)).toEqual(["s1", "s2"]);
    expect(groups[0].proxies).toEqual(data.proxies);
    expect(groups[0].visitors).toEqual(data.visitors);
    expect(groups[0].proxies[9999]).toBe(data.proxies[9999]);
    expect(groups[1].proxies).toEqual([]);
    expect(groups[1].visitors).toEqual([]);
  });

  it("does not attach orphan connections to another server and handles missing lists", () => {
    const data = fixture(2);
    data.proxies[0].serverId = "deleted";
    data.proxies[1].serverId = "s2";
    data.visitors[0].serverId = "s2";
    const groups = groupTopology(data);
    expect(groups[0].proxies).toEqual([]);
    expect(groups[0].visitors).toEqual([]);
    expect(groups[1].proxies).toEqual([data.proxies[1]]);
    expect(groups[1].visitors).toEqual(data.visitors);
    const empty = reconcileTopology(data, {});
    expect(empty).toEqual({ servers: [], proxies: [], visitors: [] });
    expect(groupTopology(empty)).toEqual([]);
  });
});
