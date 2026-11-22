import type { Proxy } from "../../types/proxy";

export interface ProxyFilters {
  serverId: string;
  type: string;
  state: string;
}

export const DEFAULT_PROXY_FILTERS: Readonly<ProxyFilters> = {
  serverId: "all",
  type: "all",
  state: "all",
};

export const PROXY_FILTER_TYPES = [
  "tcp", "udp", "http", "https", "stcp", "sudp", "xtcp", "tcpmux",
] as const satisfies readonly Proxy["proxyType"][];

const PROXY_FILTER_STATES = ["online", "offline", "disabled"] as const;

/** Unknown type/state values reset that filter to all; empty server IDs do the same. */
export function normalizeProxyFilter(key: keyof ProxyFilters, value: string): string {
  if (key === "type") return (PROXY_FILTER_TYPES as readonly string[]).includes(value) ? value : "all";
  if (key === "state") return (PROXY_FILTER_STATES as readonly string[]).includes(value) ? value : "all";
  return value.trim() || "all";
}

export function hasProxyFilters(filters: ProxyFilters): boolean {
  return (["serverId", "type", "state"] as const).some(
    (key) => normalizeProxyFilter(key, filters[key]) !== "all"
  );
}

export function proxyFiltersKey(filters: ProxyFilters): string {
  return JSON.stringify([filters.serverId, filters.type, filters.state]);
}

export function proxySelectionKey(page: number, search: string, filters: ProxyFilters): string {
  return JSON.stringify([page, search, filters.serverId, filters.type, filters.state]);
}

type BindFilter = (expression: string, params: Record<string, unknown>) => string;

/** Build the complete PocketBase query; no filtering of the returned page is needed. */
export function buildProxyFilter(filters: ProxyFilters, search: string, bind: BindFilter): string {
  const serverId = normalizeProxyFilter("serverId", filters.serverId);
  const type = normalizeProxyFilter("type", filters.type);
  const state = normalizeProxyFilter("state", filters.state);
  const conditions: string[] = [];
  if (search) conditions.push(bind("name ~ {:q} || localIP ~ {:q} || remotePort ~ {:q}", { q: search }));
  if (serverId !== "all") conditions.push(bind("serverId = {:serverId}", { serverId }));
  if (type !== "all") conditions.push(bind("proxyType = {:type}", { type }));
  if (state === "online") conditions.push('status = "enabled" && bootStatus = "online"');
  if (state === "offline") conditions.push('status = "enabled" && bootStatus != "online"');
  if (state === "disabled") conditions.push('status = "disabled"');
  return conditions.map((condition) => `(${condition})`).join(" && ");
}
