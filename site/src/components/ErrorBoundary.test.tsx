import { lazy, Suspense } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { ErrorBoundary } from "./ErrorBoundary";

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(cleanup);

describe("root ErrorBoundary", () => {
  it("catches render failures outside theme providers and retries only on demand", () => {
    let broken = true;
    const calls = vi.fn();
    function Broken() {
      calls();
      if (broken) throw new Error("secret diagnostic must not be displayed");
      return <div>Recovered</div>;
    }
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert").textContent).not.toContain("secret diagnostic");
    expect(screen.getByText("The page could not be displayed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload application" })).toBeTruthy();
    const count = calls.mock.calls.length;
    broken = false;
    expect(calls).toHaveBeenCalledTimes(count);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Recovered")).toBeTruthy();
  });

  it("handles missing lazy chunks with a manual reload instead of retrying cached failures", async () => {
    const load = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch dynamically imported module"));
    const Page = lazy(load);
    render(
      <ErrorBoundary>
        <Suspense fallback="Loading">
          <Page />
        </Suspense>
      </ErrorBoundary>
    );
    await screen.findByRole("alert");
    expect(screen.getByText(/Part of the application could not be loaded/)).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reload application" })).toBeTruthy();
  });

  it("catches Vite JS/CSS preload failures and removes its listener on unmount", async () => {
    const { unmount } = render(
      <ErrorBoundary>
        <div>Application</div>
      </ErrorBoundary>
    );
    const event = new Event("vite:preloadError", { cancelable: true });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("alert")).toBeTruthy();
    await act(() => i18n.changeLanguage("zh"));
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    expect(screen.getByRole("button", { name: "刷新应用" })).toBeTruthy();
    unmount();
    const later = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it("keeps a persistent failure recoverable without an automatic retry loop", () => {
    function Broken() {
      throw new Error("Still broken");
      return null;
    }
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload application" })).toBeTruthy();
  });
});
