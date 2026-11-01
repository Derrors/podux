import type { TopologyData } from "./useDashboard";

/** Keep unchanged records/arrays alive across polls; no JSON serialization or graph rebuild. */
function reconcileRows<T extends { id: string }>(previous: T[], incoming: T[]): T[] {
  const byId = new Map(previous.map((row) => [row.id, row]));
  const rows = incoming.map((row) => {
    const old = byId.get(row.id);
    const keys = Object.keys(row) as Array<keyof T>;
    return old &&
      keys.length === Object.keys(old).length &&
      keys.every((key) => old[key] === row[key])
      ? old
      : row;
  });
  return rows.length === previous.length && rows.every((row, i) => row === previous[i])
    ? previous
    : rows;
}

export function reconcileTopology(
  previous: TopologyData,
  incoming: Partial<TopologyData>
): TopologyData {
  const servers = reconcileRows(previous.servers, incoming.servers ?? []);
  const proxies = reconcileRows(previous.proxies, incoming.proxies ?? []);
  const visitors = reconcileRows(previous.visitors, incoming.visitors ?? []);
  return servers === previous.servers &&
    proxies === previous.proxies &&
    visitors === previous.visitors
    ? previous
    : { servers, proxies, visitors };
}

// A page never constructs more than 22 graph nodes (internet + server + 2 per row).
export const TOPOLOGY_PAGE_SIZE = 10;

export function selectTopologyPage(
  topology: TopologyData,
  serverId: string,
  page: number,
  expanded: boolean
) {
  const server = topology.servers.find((item) => item.id === serverId) ?? topology.servers[0];
  const proxies = topology.proxies.filter((item) => item.serverId === server?.id);
  const visitors = topology.visitors.filter((item) => item.serverId === server?.id);
  const total = proxies.length + visitors.length;
  const pages = Math.max(1, Math.ceil(total / TOPOLOGY_PAGE_SIZE));
  const currentPage = Math.max(0, Math.min(page, pages - 1));
  const start = currentPage * TOPOLOGY_PAGE_SIZE;
  const end = start + TOPOLOGY_PAGE_SIZE;
  return {
    total,
    pages,
    currentPage,
    topology: {
      servers: server ? [server] : [],
      proxies: expanded ? proxies.slice(start, end) : [],
      visitors: expanded
        ? visitors.slice(Math.max(0, start - proxies.length), Math.max(0, end - proxies.length))
        : [],
    },
  };
}
