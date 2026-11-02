import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { TopologyChart } from "./TopologyChart";
import type { TopologyData } from "./useDashboard";

const flow = vi.hoisted(() => vi.fn());
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: { nodes: unknown[]; children: ReactNode }) => {
    flow(props);
    return (
      <div data-testid="flow" data-count={props.nodes.length}>
        {props.children}
      </div>
    );
  },
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  BackgroundVariant: { Dots: "dots" },
  Position: { Left: "left", Right: "right" },
}));

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
    "shows every server and connection immediately in %s mode without selection or pagination",
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
      expect(screen.getByRole("button", { name: "View fullscreen" })).toBeTruthy();
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

  it("keeps fullscreen pan/zoom and offers all connections in its accessible table", () => {
    render(
      <Theme>
        <TopologyChart topology={data()} />
      </Theme>
    );
    fireEvent.click(screen.getByRole("button", { name: "View fullscreen" }));
    expect(screen.getAllByTestId("flow")).toHaveLength(1);
    expect(flow.mock.lastCall![0].panOnDrag).toBe(true);
    expect(flow.mock.lastCall![0].zoomOnScroll).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    expect(screen.getAllByRole("table")).toHaveLength(2);
    // A wide table must scroll inside the dialog, not set its mobile minimum width.
    expect(screen.getByRole("dialog").style.getPropertyValue("--max-width")).toBe(
      "min(1600px, calc(100vw - 32px))"
    );
    expect(screen.getByRole("rowheader", { name: "Proxy 0" })).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "Proxy 24" })).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "Private visitor" })).toBeTruthy();
    expect(screen.getByText(/First · one.example.com/)).toBeTruthy();
    expect(screen.getByText(/Second · two.example.com/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByTestId("flow").getAttribute("data-count")).toBe("55");
    expect(screen.queryByRole("table")).toBeNull();
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
