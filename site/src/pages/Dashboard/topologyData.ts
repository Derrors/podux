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

/** Full overview in server order; group once without filtering or paging connections away. */
export function groupTopology(topology: TopologyData) {
  const groups = topology.servers.map((server) => ({
    server,
    proxies: [] as TopologyData["proxies"],
    visitors: [] as TopologyData["visitors"],
  }));
  const byId = new Map(groups.map((group) => [group.server.id, group]));
  for (const proxy of topology.proxies) byId.get(proxy.serverId)?.proxies.push(proxy);
  for (const visitor of topology.visitors) byId.get(visitor.serverId)?.visitors.push(visitor);
  return groups;
}
