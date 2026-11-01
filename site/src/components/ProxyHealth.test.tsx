import i18n from "../i18n";
import type { ReactNode } from "react";
import { Theme } from "@radix-ui/themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as api from "../lib/api";
import type { ProxyStatus } from "../hooks/useProxyStatus";
import { ProxyHealth } from "./ProxyHealth";

// jsdom has no chart layout; keep the actual history dialog, fetch and data table.
vi.mock("recharts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("recharts")>()),
  ResponsiveContainer: () => null,
}));

const status: ProxyStatus = {
  probe: { endpoint: "example.com:18080", reachable: true, checked: "2026-01-01T00:00:00Z" },
  traffic: { todayTrafficIn: 1024, todayTrafficOut: 2048, curConns: 3, status: "online" },
};

const wrapper = ({ children }: { children: ReactNode }) => <Theme>{children}</Theme>;

beforeEach(async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

describe("ProxyHealth", () => {
  it.each([undefined, false])(
    "keeps existing reachability when probeDisabled=%s",
    (probeDisabled) => {
      const { rerender } = render(
        <ProxyHealth proxyId="p1" proxyName="web" status={status} probeDisabled={probeDisabled} />,
        { wrapper }
      );
      expect(screen.getByText("Reachable").getAttribute("data-accent-color")).toBe("green");
      expect(screen.queryByText("Probe disabled")).toBeNull();
      rerender(
        <ProxyHealth
          proxyId="p1"
          proxyName="web"
          status={{ probe: { ...status.probe!, reachable: false } }}
          probeDisabled={probeDisabled}
        />
      );
      expect(screen.getByText("Unreachable").getAttribute("data-accent-color")).toBe("red");
    }
  );

  it("keeps the dash for missing status when probing is enabled", () => {
    render(<ProxyHealth proxyId="p1" proxyName="web" />, { wrapper });
    expect(screen.getByText("-")).toBeTruthy();
    expect(screen.queryByText("Probe disabled")).toBeNull();
  });

  it.each(["light", "dark"] as const)(
    "shows a neutral disabled badge without status in the %s theme",
    (appearance) => {
      render(
        <Theme appearance={appearance}>
          <ProxyHealth proxyId="p1" proxyName="web" probeDisabled />
        </Theme>
      );
      expect(screen.getByText("Probe disabled").getAttribute("data-accent-color")).toBe("gray");
      expect(screen.queryByText("-")).toBeNull();
    }
  );

  it.each([true, false])(
    "hides stale reachable=%s results immediately while keeping traffic",
    (reachable) => {
      const staleStatus = {
        ...status,
        probe: { ...status.probe!, reachable, error: "old failure" },
      };
      const { rerender } = render(
        <ProxyHealth proxyId="p1" proxyName="web" status={staleStatus} />,
        { wrapper }
      );
      expect(screen.getByText(reachable ? "Reachable" : "Unreachable")).toBeTruthy();
      rerender(<ProxyHealth proxyId="p1" proxyName="web" status={staleStatus} probeDisabled />);
      expect(screen.getByText("Probe disabled")).toBeTruthy();
      expect(screen.queryByText("Reachable")).toBeNull();
      expect(screen.queryByText("Unreachable")).toBeNull();
      expect(screen.queryByText(/old failure/)).toBeNull();
      const traffic = screen.getByRole("button", { name: 'Traffic of "web", last 7 days' });
      expect(traffic.textContent).toBe("↓1.0 KB ↑2.0 KB · 3 conns");
    }
  );

  it("still fetches and opens traffic history when disabled and after probe results are removed", async () => {
    const get = vi
      .spyOn(api, "apiGet")
      .mockResolvedValue({ trafficIn: [1024], trafficOut: [2048] });
    const { rerender } = render(
      <ProxyHealth proxyId="p1" proxyName="web" status={status} probeDisabled />,
      { wrapper }
    );
    fireEvent.click(screen.getByRole("button", { name: 'Traffic of "web", last 7 days' }));
    const dialog = await screen.findByRole("dialog", { name: 'Traffic of "web", last 7 days' });
    await waitFor(() => expect(get).toHaveBeenCalledExactlyOnceWith("/api/proxies/p1/traffic"));
    expect(await within(dialog).findByRole("cell", { name: "1.0 KB" })).toBeTruthy();
    expect(within(dialog).getByRole("cell", { name: "2.0 KB" })).toBeTruthy();

    // A status refresh filtering out the probe must not close the history dialog.
    rerender(
      <ProxyHealth
        proxyId="p1"
        proxyName="web"
        status={{ traffic: status.traffic }}
        probeDisabled
      />
    );
    expect(screen.getByRole("dialog", { name: 'Traffic of "web", last 7 days' })).toBe(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Probe disabled")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: 'Traffic of "web", last 7 days' }).textContent
    ).toContain("↓1.0 KB ↑2.0 KB");
  });

  it("does not hide a zero-traffic history action", () => {
    render(
      <ProxyHealth
        proxyId="p1"
        proxyName="web"
        probeDisabled
        status={{
          traffic: { todayTrafficIn: 0, todayTrafficOut: 0, curConns: 0, status: "online" },
        }}
      />,
      { wrapper }
    );
    expect(screen.getByRole("button", { name: 'Traffic of "web", last 7 days' }).textContent).toBe(
      "↓0 B ↑0 B"
    );
  });

  it("translates the disabled badge into Chinese", async () => {
    await i18n.changeLanguage("zh");
    render(<ProxyHealth proxyId="p1" proxyName="web" probeDisabled />, { wrapper });
    expect(screen.getByText("探测已关闭")).toBeTruthy();
  });
});
