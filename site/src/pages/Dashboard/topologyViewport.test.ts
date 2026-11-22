import { describe, expect, it } from "vitest";
import { minimumOverviewZoom, topologyBounds } from "./topologyViewport";

describe("complete inline topology viewport", () => {
  it("uses the complete node bounds rather than only visible nodes", () => {
    const bounds = topologyBounds([
      { position: { x: -10, y: 12 }, width: 188, height: 108 },
      { position: { x: 716, y: 4000 }, width: 180, height: 84 },
    ]);
    expect(bounds).toEqual({ x: -10, y: 12, width: 906, height: 4072 });
    expect(minimumOverviewZoom(bounds, 1200, 900)).toBeLessThan(0.25);
    expect(bounds.height * minimumOverviewZoom(bounds, 1200, 900)).toBeLessThanOrEqual(450);
  });
  it.each([320, 1200])("fits 30 enlarged rows within the fixed canvas at %spx", (width) => {
    const nodes = Array.from({ length: 30 }, (_, index) => ({
      position: { x: 182, y: index * 132 + 12 },
      width: 188,
      height: 108,
    }));
    const bounds = topologyBounds(nodes);
    const floor = minimumOverviewZoom(bounds, width, 900);
    expect(floor).toBeLessThan(0.25);
    expect(bounds.height * floor).toBeLessThanOrEqual(450);
    expect(bounds.width * floor).toBeLessThanOrEqual(width / 2);
  });
  it("keeps a permissive positive floor for large graphs and empty/unmeasured panes", () => {
    expect(topologyBounds([])).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    const floor = minimumOverviewZoom({ x: 0, y: 0, width: 900, height: 1_320_000 }, 0, 0);
    expect(floor).toBeGreaterThan(0);
    expect(floor).toBeLessThan(0.001);
  });
});
