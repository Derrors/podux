interface PositionedNode {
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

export interface TopologyBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Use the full graph, including off-screen nodes, rather than the rendered subset. */
export function topologyBounds(nodes: PositionedNode[]): TopologyBounds {
  if (!nodes.length) return { x: 0, y: 0, width: 1, height: 1 };
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    left = Math.min(left, node.position.x);
    top = Math.min(top, node.position.y);
    right = Math.max(right, node.position.x + (node.width ?? 0));
    bottom = Math.max(bottom, node.position.y + (node.height ?? 0));
  }
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/** A permissive floor, not the actual fit zoom; leave room for fitView's padding. */
export function minimumOverviewZoom(bounds: TopologyBounds, width: number, height: number) {
  return Math.min(
    0.25,
    Math.max(1, width) / (bounds.width * 2),
    Math.max(1, height) / (bounds.height * 2)
  );
}
