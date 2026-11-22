import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { topologyPath } from "./topologyFocus";

const nodes = [
  "internet",
  "server",
  "proxy",
  "local",
  "sibling",
  "sibling-local",
  "other-server",
].map((id) => ({
  id,
  position: { x: 0, y: 0 },
  data: { name: id, ...(id === "local" ? { localIP: "::1", localPort: "8080" } : {}) },
})) as Node[];
const edges: Edge[] = [
  { id: "a", source: "internet", target: "server" },
  { id: "b", source: "server", target: "proxy" },
  { id: "c", source: "proxy", target: "local" },
  { id: "d", source: "server", target: "sibling" },
  { id: "e", source: "sibling", target: "sibling-local" },
  { id: "f", source: "internet", target: "other-server" },
];

describe("non-destructive topology focus", () => {
  it("highlights only ancestors and descendants, not sibling branches", () => {
    const path = topologyPath(nodes, edges, "proxy");
    expect([...path.nodeIds].sort()).toEqual(["internet", "local", "proxy", "server"]);
    expect([...path.edgeIds].sort()).toEqual(["a", "b", "c"]);
    const server = topologyPath(nodes, edges, "server");
    expect([...server.nodeIds]).not.toContain("other-server");
    expect(server.nodeIds).toContain("sibling-local");
  });
  it("handles cycles and a node removed during refresh", () => {
    expect(
      topologyPath(nodes, [...edges, { id: "cycle", source: "local", target: "proxy" }], "proxy")
        .nodeIds.size
    ).toBe(4);
    expect(topologyPath(nodes, edges, "deleted").nodeIds.size).toBe(0);
    expect(topologyPath(nodes, edges, null).nodeIds.size).toBe(0);
  });
});
