import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockViewport } from "../test/mediaQuery";
import { useMediaQuery } from "./useMediaQuery";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("viewport layouts", () => {
  it("responds at 760px and cleans up subscriptions", () => {
    const viewport = mockViewport(1440);
    const { result, unmount } = renderHook(() => useMediaQuery("(max-width: 760px)"));
    expect(result.current).toBe(false);
    act(() => viewport.setWidth(760));
    expect(result.current).toBe(true);
    act(() => viewport.setWidth(761));
    expect(result.current).toBe(false);
    unmount();
    expect(viewport.subscriptionCount).toBe(0);
  });
  it("does not force tablet user agents into a phone layout", () => {
    mockViewport(1280);
    vi.stubGlobal("navigator", { userAgent: "iPad" });
    const { result } = renderHook(() => useMediaQuery("(max-width: 760px)"));
    expect(result.current).toBe(false);
  });
});
