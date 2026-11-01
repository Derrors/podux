import { useCallback, useState } from "react";
import i18n from "../../i18n";
import { apiGet } from "../../lib/api";
import { notifyError } from "../../lib/notify";
import { STALE } from "../../lib/latestRequest";
import { useLatestRequest } from "../../hooks/useLatestRequest";
import { usePolling } from "../../hooks/usePolling";
import { reconcileTopology } from "./topologyData";

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
  const [topology, setTopology] = useState<TopologyData>({
    servers: [],
    proxies: [],
    visitors: [],
  });
  const [statsLoading, setStatsLoading] = useState(true);
  const [topologyLoading, setTopologyLoading] = useState(true);
  const [statsFailed, setStatsFailed] = useState(false);
  const [topologyFailed, setTopologyFailed] = useState(false);
  const statsRequest = useLatestRequest();
  const topologyRequest = useLatestRequest();

  const loadStats = useCallback(async () => {
    try {
      const data = await statsRequest.run((signal) =>
        apiGet<DashboardStatsResponse>("/api/dashboard/stats", { signal })
      );
      if (data === STALE) return;
      setStats(toStats(data));
      setStatsFailed(false);
      setStatsLoading(false);
    } catch (err) {
      setStatsLoading(false);
      setStatsFailed(true);
      notifyError(i18n.t("dashboard.loadFailed"), err, "dashboard-stats");
    }
  }, [statsRequest]);

  const loadTopology = useCallback(async () => {
    try {
      const data = await topologyRequest.run((signal) =>
        apiGet<TopologyData>("/api/dashboard/topology", { signal })
      );
      if (data === STALE) return;
      setTopology((previous) => reconcileTopology(previous, data ?? {}));
      setTopologyFailed(false);
      setTopologyLoading(false);
    } catch (err) {
      setTopologyLoading(false);
      setTopologyFailed(true);
      notifyError(i18n.t("dashboard.topologyLoadFailed"), err, "dashboard-topology");
    }
  }, [topologyRequest]);

  // Separate schedulers and abort controllers: a slow/failed topology never gates stats.
  usePolling(loadStats, POLL_INTERVAL_MS, { immediate: true });
  usePolling(loadTopology, POLL_INTERVAL_MS, { immediate: true });

  return {
    stats,
    topology,
    statsLoading,
    topologyLoading,
    statsFailed,
    topologyFailed,
    loadStats,
    loadTopology,
  };
}
