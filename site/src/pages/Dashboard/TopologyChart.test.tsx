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
      id: String(i),
      name: `Proxy ${i}`,
      serverId: "one",
      proxyType: "tcp",
      localIP: "127.0.0.1",
      localPort: 80,
      remotePort: 1000 + i,
      status: "enabled",
      bootStatus: "online",
    })),
    visitors: [],
  };
}

beforeEach(async () => {
  flow.mockClear();
  await i18n.changeLanguage("en");
});

afterEach(cleanup);

describe("bounded topology UI", () => {
  it.each(["light", "dark"] as const)(
    "selects, expands and pages in %s mode, with a readable table",
    (appearance) => {
      render(
        <Theme appearance={appearance}>
          <TopologyChart topology={data()} />
        </Theme>
      );
      expect(screen.getByTestId("flow").getAttribute("data-count")).toBe("2");
      fireEvent.click(screen.getByRole("button", { name: "Expand connections" }));
      expect(screen.getByTestId("flow").getAttribute("data-count")).toBe("22");
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      expect(screen.getByTestId("flow").getAttribute("data-count")).toBe("12");
      fireEvent.click(screen.getByRole("button", { name: "Table view" }));
      expect(screen.getByRole("rowheader", { name: "Proxy 24" })).toBeTruthy();
      expect(screen.queryByRole("rowheader", { name: "Proxy 0" })).toBeNull();
      fireEvent.change(screen.getByRole("combobox", { name: "Server" }), {
        target: { value: "two" },
      });
      expect(screen.queryByRole("rowheader", { name: "Proxy 24" })).toBeNull();
      expect(screen.getByText(/Second · two.example.com/)).toBeTruthy();
    }
  );

  it("does not rebuild an unchanged graph, never captures inline scroll and enables viewport culling", () => {
    const topology = data();
    const view = (
      <Theme>
        <TopologyChart topology={topology} />
      </Theme>
    );
    const { rerender } = render(view);
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
    expect(props.zoomOnScroll).toBe(false);
    expect(props.edges.every((edge: { animated: boolean }) => !edge.animated)).toBe(true);
  });

  it("translates controls without changing the selected page", async () => {
    render(
      <Theme>
        <TopologyChart topology={data()} />
      </Theme>
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand connections" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await act(() => i18n.changeLanguage("zh"));
    expect(screen.getByRole("button", { name: "折叠连接" })).toBeTruthy();
    expect(screen.getByText("2 / 3")).toBeTruthy();
  });
});
