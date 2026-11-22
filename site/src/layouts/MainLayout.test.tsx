import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { mockViewport } from "../test/mediaQuery";
import { MainLayout } from "./MainLayout";

vi.mock("../lib/api", () => ({ apiGet: () => Promise.resolve({ version: "0.2.13" }) }));
vi.mock("../hooks/useAuthRecord", () => ({
  useAuthRecord: () => ({ nickname: "Demo", email: "demo@example.test" }),
}));
vi.mock("../components/ThemeToggle", () => ({ ThemeToggle: () => <button aria-label="Theme" /> }));
vi.mock("../components/LanguageToggle", () => ({
  LanguageToggle: () => <button aria-label="Language" />,
}));
vi.mock("../components/PageTransition", () => ({
  PageTransition: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

beforeEach(async () => {
  localStorage.clear();
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

describe("console shell navigation", () => {
  it("highlights the owning section on detail routes and persists sidebar collapse", () => {
    mockViewport(1440);
    render(
      <Theme>
        <MemoryRouter initialEntries={["/servers/test/logs"]}>
          <MainLayout>
            <div>Content</div>
          </MainLayout>
        </MemoryRouter>
      </Theme>
    );
    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).getByRole("link", { name: "Podux" }).textContent).toBe("Podux");
    expect(
      within(sidebar).getByRole("link", { name: "Servers" }).getAttribute("aria-current")
    ).toBe("page");
    expect(within(sidebar).getByRole("link", { name: "Runtime logs" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(localStorage.getItem("podux.sidebarCollapsed")).toBe("true");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
    expect(within(sidebar).getByRole("link", { name: "Servers" })).toBeTruthy();
  });
  it("uses bottom navigation at phone widths and does not keep a desktop sidebar", () => {
    const viewport = mockViewport(1440);
    render(
      <Theme>
        <MemoryRouter initialEntries={["/proxies/test/edit"]}>
          <MainLayout>
            <div>Content</div>
          </MainLayout>
        </MemoryRouter>
      </Theme>
    );
    act(() => viewport.setWidth(320));
    expect(screen.queryByRole("complementary")).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    expect(within(nav).getAllByRole("link")).toHaveLength(4);
    expect(within(nav).getByRole("link", { name: "Proxies" }).getAttribute("aria-current")).toBe(
      "page"
    );
    expect(screen.getByRole("link", { name: "Skip to main content" }).getAttribute("href")).toBe(
      "#main-content"
    );
    expect(screen.getByRole("main").id).toBe("main-content");
  });
  it("keeps a compact top navigation on tablets", () => {
    mockViewport(1024);
    render(
      <Theme>
        <MemoryRouter>
          <MainLayout>
            <div>Content</div>
          </MainLayout>
        </MemoryRouter>
      </Theme>
    );
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Main navigation" }).className).toBe(
      "console-top-nav"
    );
  });
});
