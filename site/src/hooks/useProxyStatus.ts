import { useCallback, useState } from "react";
import { apiGet } from "../lib/api";
import { usePolling } from "./usePolling";

export interface ProxyTraffic {
  todayTrafficIn: number;
  todayTrafficOut: number;
  curConns: number;
  status: string;
}

export interface ProbeResult {
  endpoint: string;
  reachable: boolean;
  error?: string;
  checked: string;
}

export interface ProxyStatus {
  traffic?: ProxyTraffic;
  probe?: ProbeResult;
}

interface StatusResponse {
  proxies: Record<string, ProxyStatus>;
  /** Server ID -> dashboard error ("" when it worked), for servers with a dashboard. */
  dashboards: Record<string, string>;
}

const POLL_MS = 30_000;

/**
 * Traffic (from frps dashboards) and external probe results per proxy, refreshed
 * every 30s. Pass a server ID to limit it to one server.
 */
export function useProxyStatus(serverId?: string) {
  const [data, setData] = useState<StatusResponse>({ proxies: {}, dashboards: {} });

  const load = useCallback(async () => {
    try {
      const url = serverId ? `/api/proxies/status?serverId=${serverId}` : "/api/proxies/status";
      setData((await apiGet<StatusResponse>(url)) ?? { proxies: {}, dashboards: {} });
    } catch {
      // Status is supplementary; the proxy list itself reports load errors.
    }
  }, [serverId]);

  usePolling(load, POLL_MS, { immediate: true, restartKey: serverId });
  return { statuses: data.proxies, dashboards: data.dashboards, hasTraffic: Object.keys(data.dashboards).length > 0 };
}
