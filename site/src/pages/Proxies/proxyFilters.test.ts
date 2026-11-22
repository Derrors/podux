import PocketBase from "pocketbase";
import { describe, expect, it, vi } from "vitest";
import {
  buildProxyFilter,
  DEFAULT_PROXY_FILTERS,
  hasProxyFilters,
  normalizeProxyFilter,
  PROXY_FILTER_TYPES,
  proxyFiltersKey,
  proxySelectionKey,
} from "./proxyFilters";

const pb = new PocketBase();
const bind = (expression: string, params: Record<string, unknown>) => pb.filter(expression, params);

describe("proxy filters", () => {
  it("leaves the query unfiltered by default", () => {
    const filter = vi.fn(bind);
    expect(buildProxyFilter(DEFAULT_PROXY_FILTERS, "", filter)).toBe("");
    expect(hasProxyFilters(DEFAULT_PROXY_FILTERS)).toBe(false);
    expect(filter).not.toHaveBeenCalled();
  });

  it.each(PROXY_FILTER_TYPES)("supports the frp %s protocol", (type) => {
    expect(buildProxyFilter({ ...DEFAULT_PROXY_FILTERS, type }, "", bind)).toBe(`(proxyType = '${type}')`);
    expect(normalizeProxyFilter("type", type)).toBe(type);
  });

  it.each([
    ["online", '(status = "enabled" && bootStatus = "online")'],
    ["offline", '(status = "enabled" && bootStatus != "online")'],
    ["disabled", '(status = "disabled")'],
  ])("defines the %s state without including disabled rows as offline", (state, expected) => {
    expect(buildProxyFilter({ ...DEFAULT_PROXY_FILTERS, state }, "", bind)).toBe(expected);
  });

  it("ANDs parenthesized search, server, protocol and state clauses", () => {
    const filter = vi.fn(bind);
    const filters = { serverId: "server-b", type: "tcp", state: "offline" };
    expect(buildProxyFilter(filters, "target", filter)).toBe(
      "(name ~ 'target' || localIP ~ 'target' || remotePort ~ 'target')" +
      " && (serverId = 'server-b') && (proxyType = 'tcp')" +
      ' && (status = "enabled" && bootStatus != "online")'
    );
    expect(filter.mock.calls).toEqual([
      ["name ~ {:q} || localIP ~ {:q} || remotePort ~ {:q}", { q: "target" }],
      ["serverId = {:serverId}", { serverId: "server-b" }],
      ["proxyType = {:type}", { type: "tcp" }],
    ]);
  });

  it("passes hostile search/server values through PocketBase parameters", () => {
    const search = "' || status = 'disabled";
    const serverId = "' || serverId != ''";
    const filter = vi.fn(bind);
    const actual = buildProxyFilter({ ...DEFAULT_PROXY_FILTERS, serverId }, search, filter);
    expect(filter).toHaveBeenCalledWith("name ~ {:q} || localIP ~ {:q} || remotePort ~ {:q}", { q: search });
    expect(filter).toHaveBeenCalledWith("serverId = {:serverId}", { serverId });
    expect(actual).toBe(
      `(${pb.filter("name ~ {:q} || localIP ~ {:q} || remotePort ~ {:q}", { q: search })})` +
      ` && (${pb.filter("serverId = {:serverId}", { serverId })})`
    );
  });

  it("resets unknown types/states and empty server IDs to all", () => {
    expect(normalizeProxyFilter("type", "TCP")).toBe("all");
    expect(normalizeProxyFilter("state", "broken")).toBe("all");
    expect(normalizeProxyFilter("serverId", "  ")).toBe("all");
    const filters = { serverId: "", type: "tcp') || true", state: "broken" };
    expect(buildProxyFilter(filters, "", bind)).toBe("");
    expect(hasProxyFilters(filters)).toBe(false);
    expect(normalizeProxyFilter("serverId", " missing-server ")).toBe("missing-server");
  });

  it("uses an unambiguous identity for every page, search and filter", () => {
    const base = proxySelectionKey(1, "", DEFAULT_PROXY_FILTERS);
    expect(proxySelectionKey(2, "", DEFAULT_PROXY_FILTERS)).not.toBe(base);
    expect(proxySelectionKey(1, "search", DEFAULT_PROXY_FILTERS)).not.toBe(base);
    for (const [key, value] of [["serverId", "server-a"], ["type", "udp"], ["state", "disabled"]] as const) {
      const filters = { ...DEFAULT_PROXY_FILTERS, [key]: value };
      expect(proxyFiltersKey(filters)).not.toBe(proxyFiltersKey(DEFAULT_PROXY_FILTERS));
      expect(proxySelectionKey(1, "", filters)).not.toBe(base);
    }
    expect(proxySelectionKey(1, "a|b", { serverId: "c", type: "tcp", state: "all" })).not.toBe(
      proxySelectionKey(1, "a", { serverId: "b|c", type: "tcp", state: "all" })
    );
  });
});
