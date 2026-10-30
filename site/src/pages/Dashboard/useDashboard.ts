import { useCallback, useState } from "react";
import i18n from "../../i18n";
import { apiGet } from "../../lib/api";
import { notifyError } from "../../lib/notify";
import { STALE } from "../../lib/latestRequest";
import { useLatestRequest } from "../../hooks/useLatestRequest";
import { usePolling } from "../../hooks/usePolling";

export interface DashboardStats {
  totalProxies: number;
  runningProxies: number;
  stoppedProxies: number;
  totalServers: number;
  onlineServers: number;
  offlineServers: number;
  maxLatency: number;
  uptime: string;
  proxyTypeCounts: Record<string, number>;
  uptimeSeconds: number;
  visitorsTotal: number;
  visitorsEnabled: number;
  /** Today's frps traffic over servers with a dashboard; trafficServers = how many. */
  trafficIn: number;
  trafficOut: number;
  trafficServers: number;
}

export interface TopologyServer {
  id: string;
  serverName: string;
  serverAddr: string;
  bootStatus: string;
}

export interface TopologyProxy {
  id: string;
  name: string;
  proxyType: string;
  localIP: string;
  localPort: number;
  remotePort: number;
  status: string;
  bootStatus: string;
  serverId: string;
}

export interface TopologyVisitor {
  id: string;
  name: string;
  visitorType: string;
  serverName: string;
  bindAddr: string;
  bindPort: number;
  status: string;
  serverId: string;
}

export interface TopologyData {
  servers: TopologyServer[];
  proxies: TopologyProxy[];
  visitors: TopologyVisitor[];
}

interface DashboardStatsResponse {
  proxiesEnabledCount: number;
  proxiesDisabledCount: number;
  proxiesOnlineCount?: number;
  runningCount: number;
  stoppedCount: number;
  maxLatency?: number;
  proxyTypeCounts?: Record<string, number>;
  uptimeSeconds?: number;
  visitorsTotal?: number;
  visitorsEnabled?: number;
  trafficIn?: number;
  trafficOut?: number;
  trafficServers?: number;
}

const POLL_INTERVAL_MS = 30_000;

const EMPTY_STATS: DashboardStats = {
  totalProxies: 0,
  runningProxies: 0,
  stoppedProxies: 0,
  totalServers: 0,
  onlineServers: 0,
  offlineServers: 0,
  maxLatency: 0,
  uptime: "0h 0m",
  proxyTypeCounts: {},
  uptimeSeconds: 0,
  visitorsTotal: 0,
  visitorsEnabled: 0,
  trafficIn: 0,
  trafficOut: 0,
  trafficServers: 0,
};

function toStats(data: DashboardStatsResponse): DashboardStats {
  return {
    totalProxies: data.proxiesEnabledCount + data.proxiesDisabledCount,
    runningProxies: data.proxiesOnlineCount ?? 0,
    stoppedProxies: data.proxiesDisabledCount,
    totalServers: data.runningCount + data.stoppedCount,
    onlineServers: data.runningCount,
    offlineServers: data.stoppedCount,
    maxLatency: data.maxLatency || 0,
    uptime: "N/A",
    proxyTypeCounts: data.proxyTypeCounts || {},
    uptimeSeconds: data.uptimeSeconds || 0,
    visitorsTotal: data.visitorsTotal ?? 0,
    visitorsEnabled: data.visitorsEnabled ?? 0,
    trafficIn: data.trafficIn ?? 0,
    trafficOut: data.trafficOut ?? 0,
    trafficServers: data.trafficServers ?? 0,
  };
}

export function useDashboard() {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [topology, setTopology] = useState<TopologyData>({ servers: [], proxies: [], visitors: [] });
  const request = useLatestRequest();

  const load = useCallback(async () => {
    try {
      const result = await request.run((signal) =>
        Promise.all([
          apiGet<DashboardStatsResponse>("/api/dashboard/stats", { signal }),
          apiGet<TopologyData>("/api/dashboard/topology", { signal }),
        ])
      );
      if (result === STALE) return;
      const [statsData, topologyData] = result;
      setStats(toStats(statsData));
      setTopology({
        servers: topologyData?.servers ?? [],
        proxies: topologyData?.proxies ?? [],
        visitors: topologyData?.visitors ?? [],
      });
    } catch (err) {
      notifyError(i18n.t("dashboard.loadFailed"), err, "dashboard-load");
    }
  }, [request]);

  usePolling(load, POLL_INTERVAL_MS, { immediate: true });

  return { stats, topology };
}
