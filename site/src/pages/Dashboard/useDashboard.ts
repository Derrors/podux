import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
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
  localPort: string;
  remotePort: string;
  status: string;
  bootStatus: string;
  serverId: string;
}

export interface TopologyData {
  servers: TopologyServer[];
  proxies: TopologyProxy[];
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
  };
}

export function useDashboard() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [topology, setTopology] = useState<TopologyData>({ servers: [], proxies: [] });
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
      });
    } catch (err) {
      notifyError(t("dashboard.loadFailed"), err, "dashboard-load");
    }
  }, [request, t]);

  usePolling(load, POLL_INTERVAL_MS, { immediate: true });

  return { stats, topology };
}
