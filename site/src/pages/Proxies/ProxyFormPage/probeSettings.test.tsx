import i18n from "../../../i18n";
import type { ReactNode } from "react";
import { Theme } from "@radix-ui/themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as api from "../../../lib/api";
import pb from "../../../lib/pocketbase";
import type { Proxy } from "../../../types/proxy";
import { ProxyFormPage } from "./index";
import { useProxyForm } from "./useProxyForm";

const record: Proxy = {
  id: "p1",
  serverId: "s1",
  name: "web",
  proxyType: "tcp",
  localIP: "127.0.0.1",
  localPort: 8080,
  remotePort: 18080,
  transport: { useEncryption: true, useCompression: true, bandwidthLimit: "2MB" },
  healthCheck: {
    type: "http",
    path: "/ready",
    intervalSeconds: 17,
    timeoutSeconds: 4,
    maxFailed: 2,
  },
  status: "disabled",
  bootStatus: "online",
  created: "",
  updated: "",
};

const getOne = vi.fn();
const create = vi.fn();
const update = vi.fn();

function routerWrapper(path: string) {
  return ({ children }: { children: ReactNode }) => (
    <Theme appearance="light">
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/proxies/new" element={children} />
          <Route path="/proxies/:id/edit" element={children} />
          <Route path="/proxies" element={null} />
        </Routes>
      </MemoryRouter>
    </Theme>
  );
}

beforeEach(async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(vi.fn());
  // Radix scroll areas observe element sizes; jsdom has no layout observer.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
  await i18n.changeLanguage("en");
  getOne.mockReset().mockResolvedValue(record);
  create.mockReset().mockResolvedValue({ id: "p2" });
  update.mockReset().mockResolvedValue(record);
  vi.spyOn(pb, "collection").mockReturnValue({ getOne, create, update } as never);
  vi.spyOn(api, "apiGet").mockResolvedValue([
    { id: "s1", serverName: "Server", bootStatus: "running" },
  ]);
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

describe("external probe form persistence", () => {
  it.each([true, false])(
    "creates a proxy with probeEnabled=%s saved inversely",
    async (enabled) => {
      const { result } = renderHook(() => useProxyForm(), {
        wrapper: routerWrapper("/proxies/new"),
      });
      await waitFor(() => expect(result.current.formData.serverId).toBe("s1"));
      expect(result.current.formData.probeEnabled).toBe(true);
      act(() => {
        result.current.handleChange("name", "web");
        result.current.handleChange("localPort", "8080");
        result.current.handleChange("remotePort", "18080");
        if (!enabled) result.current.handleChange("probeEnabled", false);
      });
      await act(() => result.current.handleSubmit());
      expect(create).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          probeDisabled: !enabled,
          status: "enabled",
          bootStatus: "offline",
          healthCheck: null,
        })
      );
      expect(update).not.toHaveBeenCalled();
    }
  );

  describe.each([undefined, false, true])("loaded probeDisabled=%s", (probeDisabled) => {
    beforeEach(() => {
      getOne.mockResolvedValue({
        ...record,
        ...(probeDisabled === undefined ? {} : { probeDisabled }),
      });
    });

    it("preserves the setting on edit and leaves healthCheck, transport and status alone", async () => {
      const { result } = renderHook(() => useProxyForm(), {
        wrapper: routerWrapper("/proxies/p1/edit"),
      });
      await waitFor(() => expect(result.current.loadingProxy).toBe(false));
      expect(result.current.formData.probeEnabled).toBe(probeDisabled !== true);
      act(() => result.current.handleChange("description", "edited"));
      await act(() => result.current.handleSubmit());
      expect(update).toHaveBeenCalledExactlyOnceWith(
        "p1",
        expect.objectContaining({
          probeDisabled: probeDisabled === true,
          description: "edited",
          healthCheck: record.healthCheck,
          transport: record.transport,
          remotePort: "18080",
        })
      );
      expect(update.mock.calls[0][1]).not.toHaveProperty("status");
      expect(update.mock.calls[0][1]).not.toHaveProperty("bootStatus");
    });

    it("preserves the setting when cloning", async () => {
      const { result } = renderHook(() => useProxyForm(), {
        wrapper: routerWrapper("/proxies/new?from=p1"),
      });
      await waitFor(() => expect(result.current.loadingProxy).toBe(false));
      expect(result.current.formData.probeEnabled).toBe(probeDisabled !== true);
      expect(result.current.formData.remotePort).toBe("");
      act(() => result.current.handleChange("remotePort", "18081"));
      await act(() => result.current.handleSubmit());
      expect(create).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          name: "web-copy",
          probeDisabled: probeDisabled === true,
          healthCheck: record.healthCheck,
          remotePort: "18081",
        })
      );
      expect(update).not.toHaveBeenCalled();
    });
  });

  it.each(["udp", "stcp", "sudp", "xtcp", "tcpmux"] as const)(
    "keeps a disabled probe on an unsupported %s record and across type changes",
    async (proxyType) => {
      getOne.mockResolvedValue({
        ...record,
        proxyType,
        probeDisabled: true,
        secretKey: "secret",
        subdomain: "web",
      });
      const { result } = renderHook(() => useProxyForm(), {
        wrapper: routerWrapper("/proxies/p1/edit"),
      });
      await waitFor(() => expect(result.current.loadingProxy).toBe(false));
      expect(result.current.formData.probeEnabled).toBe(false);
      act(() => result.current.handleChange("type", "tcp"));
      expect(result.current.formData.probeEnabled).toBe(false);
      act(() => result.current.handleChange("type", proxyType));
      await act(() => result.current.handleSubmit());
      expect(update).toHaveBeenCalledExactlyOnceWith(
        "p1",
        expect.objectContaining({
          proxyType,
          probeDisabled: true,
          healthCheck: record.healthCheck,
        })
      );
    }
  );
});

describe("external probe switch", () => {
  it("is on by default, has an associated description and only appears for supported types", async () => {
    render(<ProxyFormPage />, { wrapper: routerWrapper("/proxies/new") });
    const toggle = await screen.findByRole("switch", { name: "External reachability probe" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    const description = document.getElementById(toggle.getAttribute("aria-describedby")!);
    expect(description?.textContent).toContain("healthCheck");
    expect(description?.textContent).toContain("does not enable or disable the proxy");

    fireEvent.click(toggle);
    for (const type of ["UDP", "STCP", "SUDP", "XTCP", "TCPMUX"]) {
      fireEvent.click(screen.getByRole("button", { name: type }));
      expect(screen.queryByRole("switch", { name: "External reachability probe" })).toBeNull();
    }
    for (const type of ["TCP", "HTTP", "HTTPS"]) {
      fireEvent.click(screen.getByRole("button", { name: type }));
      expect(
        screen
          .getByRole("switch", { name: "External reachability probe" })
          .getAttribute("aria-checked")
      ).toBe("false");
    }
  });

  it.each([false, true])(
    "toggles and saves a loaded probeDisabled=%s without changing healthCheck or tunnel settings",
    async (probeDisabled) => {
      getOne.mockResolvedValue({ ...record, probeDisabled });
      render(<ProxyFormPage />, { wrapper: routerWrapper("/proxies/p1/edit") });
      const toggle = await screen.findByRole("switch", { name: "External reachability probe" });
      expect(toggle.getAttribute("aria-checked")).toBe(String(!probeDisabled));

      // Clicking the visible label must operate the switch as well.
      fireEvent.click(screen.getByText("External reachability probe", { selector: "label" }));
      expect(toggle.getAttribute("aria-checked")).toBe(String(probeDisabled));
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
      await waitFor(() =>
        expect(update).toHaveBeenCalledExactlyOnceWith(
          "p1",
          expect.objectContaining({
            probeDisabled: !probeDisabled,
            healthCheck: record.healthCheck,
            transport: record.transport,
            proxyType: record.proxyType,
            localIP: record.localIP,
            localPort: "8080",
            remotePort: "18080",
          })
        )
      );
      expect(update.mock.calls[0][1]).not.toHaveProperty("status");
      expect(update.mock.calls[0][1]).not.toHaveProperty("bootStatus");
    }
  );

  it("keeps the probe switch available with a plugin and translates without losing edits", async () => {
    getOne.mockResolvedValue({ ...record, plugin: { type: "socks5" }, probeDisabled: true });
    render(<ProxyFormPage />, { wrapper: routerWrapper("/proxies/p1/edit") });
    const toggle = await screen.findByRole("switch", { name: "External reachability probe" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("Health check")).toBeNull();
    fireEvent.click(toggle);
    await act(() => i18n.changeLanguage("zh"));
    expect(
      screen.getByRole("switch", { name: "外网可达性探测" }).getAttribute("aria-checked")
    ).toBe("true");
    expect(getOne).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith(
        "p1",
        expect.objectContaining({
          probeDisabled: false,
          plugin: { type: "socks5" },
          healthCheck: null,
        })
      )
    );
  });
});
