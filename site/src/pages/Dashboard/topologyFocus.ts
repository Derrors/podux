import type { Edge, Node } from "@xyflow/react";

/** Ancestors plus the selected node's descendants, not unrelated siblings. Linear in graph size. */
export function topologyPath(nodes: Node[], edges: Edge[], selectedId: string | null) {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  if (!selectedId || !nodes.some((node) => node.id === selectedId)) return { nodeIds, edgeIds };
  const incoming = new Map<string, Edge[]>();
  const outgoing = new Map<string, Edge[]>();
  for (const edge of edges) {
    const parents = incoming.get(edge.target) ?? [];
    parents.push(edge);
    incoming.set(edge.target, parents);
    const children = outgoing.get(edge.source) ?? [];
    children.push(edge);
    outgoing.set(edge.source, children);
  }
  const walk = (index: Map<string, Edge[]>, direction: "source" | "target") => {
    const queue = [selectedId];
    const visited = new Set<string>();
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor];
      if (visited.has(id)) continue;
      visited.add(id);
      nodeIds.add(id);
      for (const edge of index.get(id) ?? []) {
        edgeIds.add(edge.id);
        queue.push(edge[direction]);
      }
    }
  };
  walk(incoming, "source");
  walk(outgoing, "target");
  return { nodeIds, edgeIds };
}
