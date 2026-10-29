import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePolling } from "./usePolling";

let visibility: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePolling", () => {
  it("calls the callback every interval", async () => {
    const callback = vi.fn();
    renderHook(() => usePolling(callback, 1000));

    expect(callback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(callback).toHaveBeenCalledTimes(4);
  });

  it("runs immediately when requested", async () => {
    const callback = vi.fn();
    renderHook(() => usePolling(callback, 1000, { immediate: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("never starts a tick while the previous one is in flight", async () => {
    const pending = deferred();
    const callback = vi.fn(() => pending.promise);
    renderHook(() => usePolling(callback, 1000));

    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledTimes(1);

    // Far past several intervals: still only the one in-flight call.
    await vi.advanceTimersByTimeAsync(10_000);
    // Becoming visible again must not start a parallel tick either.
    setVisibility("hidden");
    setVisibility("visible");
    expect(callback).toHaveBeenCalledTimes(1);

    pending.resolve();
    await vi.advanceTimersByTimeAsync(0);
    // The next tick is scheduled one interval after the previous one settled.
    await vi.advanceTimersByTimeAsync(999);
    expect(callback).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("pauses while hidden and refreshes once when visible again", async () => {
    const callback = vi.fn();
    renderHook(() => usePolling(callback, 1000));

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(5000);
    expect(callback).not.toHaveBeenCalled();

    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("keeps polling after the callback throws", async () => {
    const callback = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    renderHook(() => usePolling(callback, 1000));
    await vi.advanceTimersByTimeAsync(2000);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("uses the latest callback without restarting the timer", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => usePolling(cb, 1000), {
      initialProps: { cb: first },
    });
    await vi.advanceTimersByTimeAsync(600);
    rerender({ cb: second });
    await vi.advanceTimersByTimeAsync(400);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops on unmount and when disabled", async () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => usePolling(callback, 1000));
    unmount();
    await vi.advanceTimersByTimeAsync(5000);
    setVisibility("hidden");
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).not.toHaveBeenCalled();

    renderHook(() => usePolling(callback, 1000, { enabled: false }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(callback).not.toHaveBeenCalled();
  });

  it("restarts with an immediate tick when restartKey changes", async () => {
    const callback = vi.fn();
    const { rerender } = renderHook(
      ({ id }) => usePolling(callback, 1000, { immediate: true, restartKey: id }),
      { initialProps: { id: "a" } }
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(1);
    rerender({ id: "b" });
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
