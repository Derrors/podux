import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { ProxyDistribution } from "./ProxyDistribution";

beforeEach(async () => {
  await i18n.changeLanguage("en");
  // jsdom has no layout observer; focusing the real Radix tooltip mounts its popper.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("proxy distribution", () => {
  it("renders every protocol including unknown types in an accessible, sorted table", () => {
    render(
      <Theme>
        <ProxyDistribution counts={{ tcp: 8, udp: 2, xtcp: 3, custom: 1, http: 0 }} />
      </Theme>
    );
    const table = screen.getByRole("table", { name: "Proxy Type Distribution" });
    const types = within(table)
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent);
    expect(types).toEqual(["TCP", "XTCP", "UDP", "CUSTOM"]);
    expect(within(table).getByRole("cell", { name: "57.1%" })).toBeTruthy();
    const value = within(table).getByRole("cell", { name: "8" }).querySelector("[tabindex='0']")!;
    expect(value).toBeTruthy();
    fireEvent.focus(value);
  });

  it("shows the translated empty state without NaN percentages", async () => {
    await i18n.changeLanguage("zh");
    render(
      <Theme>
        <ProxyDistribution counts={{ tcp: 0 }} />
      </Theme>
    );
    expect(screen.getByText("暂无代理配置")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
