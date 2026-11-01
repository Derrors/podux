import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitForRestore, RestoreTimeoutError } from "./restoreJob";

const fetchMock = vi.fn<typeof fetch>();
const id = "1".repeat(64);
const job = (state: string) => new Response(JSON.stringify({ id, state }), { headers: { "Content-Type": "application/json" } });

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("does not treat a healthy old process or running job as success", async () => {
  fetchMock.mockImplementation(async () => job("running"));
  const controller = new AbortController();
  const result = waitForRestore(id, controller.signal, 4000);
  const assertion = expect(result).rejects.toBeInstanceOf(RestoreTimeoutError);
  await vi.advanceTimersByTimeAsync(4000);
  await assertion;
  expect(fetchMock.mock.calls.every(([url]) => url === "/api/system/backups/restore-status")).toBe(true);
});

it("recognizes a failed restore even while the process responds", async () => {
  fetchMock.mockResolvedValue(job("failed"));
  await expect(waitForRestore(id, new AbortController().signal)).resolves.toMatchObject({ state: "failed" });
});

it("accepts confirmed success without needing to observe downtime", async () => {
  fetchMock.mockResolvedValue(job("succeeded"));
  await expect(waitForRestore(id, new AbortController().signal)).resolves.toMatchObject({ state: "succeeded" });
  const [, options] = fetchMock.mock.calls[0];
  expect(new Headers(options?.headers).get("X-Podux-Restore-ID")).toBe(id);
  expect(options?.credentials).toBe("omit");
});

it("retries a network failure during restart", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("network error")).mockResolvedValueOnce(job("succeeded"));
  const result = waitForRestore(id, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1500);
  await expect(result).resolves.toMatchObject({ state: "succeeded" });
});

it("bounds individual hung requests and the overall wait", async () => {
  fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(new DOMException("abort", "AbortError")));
  }));
  const result = waitForRestore(id, new AbortController().signal, 6000);
  const assertion = expect(result).rejects.toBeInstanceOf(RestoreTimeoutError);
  await vi.advanceTimersByTimeAsync(6000);
  await assertion;
});

it("cancels polling on unmount", async () => {
  fetchMock.mockResolvedValue(job("running"));
  const controller = new AbortController();
  const result = waitForRestore(id, controller.signal);
  const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await assertion;
});
