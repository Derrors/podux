import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { mockViewport } from "../test/mediaQuery";
import { ServersView } from "./Servers/ServersPage.view";
import { ProxiesView } from "./Proxies/ProxiesPage.view";
import { VisitorsView } from "./Visitors/VisitorsPage.view";
import { ServerProxyList } from "../components/ServerProxyList";
import type { Proxy } from "../types/proxy";
import type { Visitor } from "../types/visitor";
import type { ServerListItem } from "../types/server";

vi.mock("../hooks/useDelayedMount", () => ({ useDelayedMount: () => true }));
const proxy: Proxy = {
  id: "p1",
  serverId: "s1",
  name: "Test proxy",
  proxyType: "tcp",
  localIP: "::1",
  localPort: 8080,
  remotePort: 18080,
  status: "disabled",
  bootStatus: "online",
  created: "",
  updated: "",
  expand: { serverId: { serverName: "Test server" } },
};
const server: ServerListItem = {
  id: "s1",
  serverName: "Test server",
  serverAddr: "test.example.com",
  serverPort: 7000,
  bootStatus: "running",
  user: "",
  description: "Server details",
  autoConnection: false,
  created: "",
  updated: "",
  networkStatus: { reachable: true, latency: 25, lastCheckTime: "" },
};
const visitor: Visitor = {
  id: "v1",
  serverId: "s1",
  name: "Test visitor",
  visitorType: "stcp",
  serverName: "remote-name",
  bindAddr: "::1",
  bindPort: 9000,
  status: "enabled",
  created: "",
  updated: "",
};
const base = {
  loading: false,
  refreshing: false,
  page: 1,
  setPage: vi.fn(),
  totalPages: 2,
  search: "",
  setSearch: vi.fn(),
};
const proxyProps = () => ({
  ...base,
  proxies: [proxy],
  stats: { total: 10, online: 4, offline: 6 },
  deleteProxy: vi.fn().mockResolvedValue(undefined),
  toggleStatus: vi.fn().mockResolvedValue(undefined),
  statuses: {},
  subdomainHosts: {},
  servers: [],
  selected: new Set<string>(),
  toggleSelected: vi.fn(),
  selectPage: vi.fn(),
  runBatch: vi.fn().mockResolvedValue(undefined),
  batchBusy: false,
  refreshProxies: vi.fn(),
  totalItems: 10,
  filters: { serverId: "all", type: "all", state: "all" },
  setFilter: vi.fn(),
  resetFilters: vi.fn(),
  hasFilters: false,
});
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <Theme>
    <MemoryRouter>{children}</MemoryRouter>
  </Theme>
);

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("responsive resource lists", () => {
  it("changes proxies from 8-column table to cards at 760px without losing data or configuration actions", () => {
    const viewport = mockViewport(1440);
    const props = proxyProps();
    render(<ProxiesView {...props} />, { wrapper });
    expect(within(screen.getByRole("table")).getAllByRole("columnheader")).toHaveLength(8);
    expect(screen.getByText("Stopped by configuration").getAttribute("data-accent-color")).toBe(
      "gray"
    );
    expect(screen.getByRole("button", { name: "Copy [::1]:8080" })).toBeTruthy();
    act(() => viewport.setWidth(760));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Test proxy")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Click to enable" }));
    expect(props.toggleStatus).toHaveBeenCalledWith(proxy);
    expect(screen.getByRole("checkbox", { name: "Select proxy Test proxy" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More actions for Test proxy" })).toBeTruthy();
  });
  it("keeps the all-page batch checkbox and clears a filtered empty state instead of prompting creation", () => {
    mockViewport(320);
    const props = proxyProps();
    props.proxies = [];
    props.hasFilters = true;
    props.filters.state = "offline";
    render(<ProxiesView {...props} />, { wrapper });
    expect(screen.getByText("No resources match")).toBeTruthy();
    expect(screen.queryByText("Create Your First Proxy")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" }).at(-1)!);
    expect(props.resetFilters).toHaveBeenCalled();
    expect(props.setSearch).toHaveBeenCalledWith("");
  });
  it("renders server cards with a full address, runtime state and start/stop action", () => {
    mockViewport(320);
    const stop = vi.fn();
    render(
      <ServersView
        {...base}
        servers={[server]}
        stats={{ total: 1, running: 1, stopped: 0 }}
        pendingId={null}
        deleteServer={vi.fn()}
        launchServer={vi.fn()}
        terminateServer={stop}
        refreshServers={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy test.example.com:7000" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(stop).toHaveBeenCalledWith("s1");
    fireEvent.click(screen.getByText("View details"));
    expect(screen.getByText("Server details").closest("details")?.open).toBe(true);
  });
  it("renders visitor cards with a readable IPv6 listener", () => {
    mockViewport(320);
    render(
      <VisitorsView
        {...base}
        visitors={[visitor]}
        deleteVisitor={vi.fn().mockResolvedValue(undefined)}
        toggleStatus={vi.fn().mockResolvedValue(undefined)}
        refreshVisitors={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy [::1]:9000" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More actions for Test visitor" })).toBeTruthy();
  });
  it("reuses the same neutral tunnel state and mobile mapping in server details", () => {
    mockViewport(320);
    render(
      <ServerProxyList
        proxies={[proxy]}
        statuses={{}}
        togglingId={null}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { wrapper }
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("Stopped by configuration").getAttribute("data-accent-color")).toBe(
      "gray"
    );
    expect(screen.getByRole("button", { name: "Copy [::1]:8080" })).toBeTruthy();
  });
  it("keeps selections and batch operations visible on mobile", () => {
    mockViewport(320);
    const props = proxyProps();
    props.selected = new Set([proxy.id]);
    render(<ProxiesView {...props} />, { wrapper });
    const toolbar = screen.getByRole("toolbar", { name: "Batch actions" });
    expect(within(toolbar).getByText("1 selected")).toBeTruthy();
    fireEvent.click(within(toolbar).getByRole("button", { name: "Enable" }));
    expect(props.runBatch).toHaveBeenCalledWith("enable");
  });
});
