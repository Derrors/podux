import { useEffect, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { TopologyChart } from "./TopologyChart";
import type { TopologyData } from "./useDashboard";

const flow = vi.hoisted(() => vi.fn());
const flowInstance = vi.hoisted(() => ({
  fitView: vi.fn().mockResolvedValue(true),
  setViewport: vi.fn().mockResolvedValue(true),
  setCenter: vi.fn().mockResolvedValue(true),
}));
vi.mock("@xyflow/react", async (importOriginal) => {
  const { getViewportForBounds } = await importOriginal<typeof import("@xyflow/react")>();
  return {
    getViewportForBounds,
    ReactFlow: (props: {
      nodes: unknown[];
      children: ReactNode;
      onInit?: (instance: never) => void;
    }) => {
      flow(props);
      const { onInit } = props;
      useEffect(() => {
        onInit?.(flowInstance as never);
      }, [onInit]);
      return (
        <div data-testid="flow" data-count={props.nodes.length}>
          {props.children}
        </div>
      );
    },
    Background: () => null,
    Controls: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    ControlButton: (props: React.ComponentProps<"button">) => <button {...props} />,
    Handle: () => null,
    BackgroundVariant: { Dots: "dots" },
    Position: { Left: "left", Right: "right" },
  };
});

function data(): TopologyData {
  return {
    servers: [
      { id: "one", serverName: "First", serverAddr: "one.example.com", bootStatus: "running" },
      { id: "two", serverName: "Second", serverAddr: "two.example.com", bootStatus: "stopped" },
    ],
    proxies: Array.from({ length: 25 }, (_, i) => ({
      id: `p${i}`,
      name: `Proxy ${i}`,
      serverId: "one",
      proxyType: "tcp",
      localIP: "127.0.0.1",
      localPort: 80,
      remotePort: 1000 + i,
      status: "enabled",
      bootStatus: "online",
    })),
    visitors: [
      {
        id: "v1",
        name: "Private visitor",
        serverId: "two",
        visitorType: "stcp",
        serverName: "remote-private",
        bindAddr: "127.0.0.1",
        bindPort: 18080,
        status: "enabled",
      },
    ],
  };
}

beforeEach(async () => {
  flow.mockClear();
  flowInstance.fitView.mockClear();
  flowInstance.setViewport.mockClear();
  flowInstance.setCenter.mockClear();
  // jsdom has no geometry; keep the real bounds-to-viewport math with a measured pane.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 1000,
    bottom: 700,
    width: 1000,
    height: 700,
    toJSON: () => ({}),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  await i18n.changeLanguage("en");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("complete topology overview", () => {
  it.each(["light", "dark"] as const)(
    "shows every server and connection immediately in %s mode without selection, legend or pagination",
    (appearance) => {
      render(
        <Theme appearance={appearance}>
          <TopologyChart topology={data()} />
        </Theme>
      );
      // Internet + both servers + all 25 proxy/local pairs + visitor/listener pair.
      expect(screen.getByTestId("flow").getAttribute("data-count")).toBe("55");
      const nodes = flow.mock.lastCall![0].nodes as Array<{ id: string }>;
      expect(nodes.map((node) => node.id)).toEqual(
        expect.arrayContaining([
          "visitor",
          "one",
          "two",
          "p0",
          "p24",
          "local-p24",
          "v1",
          "listen-v1",
        ])
      );
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.queryByRole("button", { name: /connections|page|Table view/i })).toBeNull();
      const fullscreenButtons = screen.getAllByRole("button", { name: "View fullscreen" });
      expect(fullscreenButtons).toHaveLength(1);
      expect(fullscreenButtons[0].textContent).toBe("");
      expect(fullscreenButtons[0].getAttribute("aria-label")).toBe("View fullscreen");
      expect(screen.queryByText("Complete overview")).toBeNull();
      expect(screen.queryByText(/\d+ servers · \d+ proxies · \d+ visitors/)).toBeNull();
      expect(screen.queryByText("Active runtime state")).toBeNull();
    }
  );

  it("does not rebuild an unchanged graph and never captures inline scrolling", () => {
    const topology = data();
    const { rerender } = render(
      <Theme>
        <TopologyChart topology={topology} />
      </Theme>
    );
    const before = flow.mock.calls.length;
    rerender(
      <Theme>
        <TopologyChart topology={topology} />
      </Theme>
    );
    expect(flow.mock.calls).toHaveLength(before);
    const props = flow.mock.lastCall![0];
    expect(props.onlyRenderVisibleElements).toBe(true);
    expect(props.preventScrolling).toBe(false);
    expect(props.panOnDrag).toBe(false);
    expect(props.zoomOnScroll).toBe(false);
    expect(props.zoomOnPinch).toBe(false);
    expect(props.edges.every((edge: { animated: boolean }) => !edge.animated)).toBe(true);
  });

  it("opens a clean fullscreen canvas without hint text, table view or node search", () => {
    render(
      <Theme>
        <TopologyChart topology={data()} />
      </Theme>
    );
    fireEvent.click(screen.getByRole("button", { name: "View fullscreen" }));
    expect(screen.getAllByTestId("flow")).toHaveLength(1);
    expect(flow.mock.lastCall![0].panOnDrag).toBe(true);
    expect(flow.mock.lastCall![0].zoomOnScroll).toBe(true);
    expect(screen.getByRole("dialog").style.getPropertyValue("--max-width")).toBe(
      "min(1600px, calc(100vw - 32px))"
    );
    expect(screen.queryByRole("button", { name: /Table view|Graph view/i })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/Drag to pan/i)).toBeNull();
    expect(screen.queryByText("Active runtime state")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByTestId("flow").getAttribute("data-count")).toBe("55");
    expect(flow.mock.lastCall![0].panOnDrag).toBe(false);
  });

  it("translates fullscreen controls without hiding any connections", async () => {
    render(
      <Theme>
        <TopologyChart topology={data()} />
      </Theme>
    );
    await act(() => i18n.changeLanguage("zh"));
    expect(screen.getByRole("button", { name: "全屏查看" })).toBeTruthy();
    expect(screen.getByTestId("flow").getAttribute("data-count")).toBe("55");
  });

  it("highlights clicked chains without removing nodes, keeps disabled edges dashed, and preserves viewport on refresh", () => {
    const topology = data();
    topology.proxies[0].status = "disabled";
    const { rerender } = render(
      <Theme>
        <TopologyChart topology={topology} />
      </Theme>
    );
    const inline = flow.mock.lastCall![0];
    expect(
      inline.edges.find((edge: { id: string }) => edge.id === "e-one-p0").style.strokeDasharray
    ).toBe("5 4");
    expect(
      inline.edges.find((edge: { id: string }) => edge.id === "e-p0-local-p0").style.strokeDasharray
    ).toBe("5 4");
    fireEvent.click(screen.getByRole("button", { name: "View fullscreen" }));
    const overviewCount = flowInstance.setViewport.mock.calls.length;
    const fullscreenProps = flow.mock.lastCall![0];
    act(() => fullscreenProps.onNodeClick({}, { id: "p24" }));
    const focused = flow.mock.lastCall![0];
    expect(focused.nodes).toHaveLength(55);
    expect(focused.nodes.find((node: { id: string }) => node.id === "p24").style.opacity).toBe(1);
    expect(focused.nodes.find((node: { id: string }) => node.id === "p0").style.opacity).toBe(0.35);

    const refreshed = {
      ...topology,
      proxies: topology.proxies.map((proxy) =>
        proxy.id === "p0" ? { ...proxy, bootStatus: "offline" } : proxy
      ),
    };
    rerender(
      <Theme>
        <TopologyChart topology={refreshed} />
      </Theme>
    );
    expect(flowInstance.setViewport).toHaveBeenCalledTimes(overviewCount);
    expect(flow.mock.lastCall![0].nodes).toHaveLength(55);

    fireEvent.click(screen.getByRole("button", { name: "Fit to view" }));
    expect(flowInstance.setViewport).toHaveBeenCalledTimes(overviewCount + 1);
    expect(flowInstance.fitView).not.toHaveBeenCalled();
  });

  it("sets explicit dimensions and permits fitting every branch below the old zoom floor", () => {
    const topology: TopologyData = {
      servers: Array.from({ length: 30 }, (_, index) => ({
        id: `server-${index}`,
        serverName: `Server ${index}`,
        serverAddr: `${index}.example.test`,
        bootStatus: "running",
      })),
      proxies: [],
      visitors: [],
    };
    render(
      <Theme>
        <TopologyChart topology={topology} />
      </Theme>
    );
    const props = flow.mock.lastCall![0];
    expect(props.nodes).toHaveLength(31);
    expect(
      props.nodes.every((node: { width?: number; height?: number }) =>
        Boolean(node.width && node.height)
      )
    ).toBe(true);
    expect(props.minZoom).toBeLessThan(0.25);
    expect(props.panOnDrag).toBe(false);
  });

  it("handles an empty installation without showing graph controls", () => {
    render(
      <Theme>
        <TopologyChart topology={{ servers: [], proxies: [], visitors: [] }} />
      </Theme>
    );
    expect(screen.getByText("No servers configured")).toBeTruthy();
    expect(screen.queryByTestId("flow")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
