import { describe, expect, it } from "vitest";
import { createLatestRequest, STALE } from "./latestRequest";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createLatestRequest", () => {
  it("drops a response that finishes after a newer request started", async () => {
    const request = createLatestRequest();
    const slow = deferred<string>();
    const fast = deferred<string>();
    const signals: AbortSignal[] = [];

    const first = request.run((signal) => (signals.push(signal), slow.promise));
    const second = request.run((signal) => (signals.push(signal), fast.promise));

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    fast.resolve("new");
    slow.resolve("old");
    await expect(second).resolves.toBe("new");
    await expect(first).resolves.toBe(STALE);
  });

  it("treats errors of superseded requests and aborts as stale", async () => {
    const request = createLatestRequest();
    const old = deferred<string>();
    const first = request.run(() => old.promise);
    const second = request.run(async () => "ok");
    old.reject(new Error("network down"));
    await expect(first).resolves.toBe(STALE);
    await expect(second).resolves.toBe("ok");

    await expect(
      request.run(async () => {
        throw new DOMException("aborted", "AbortError");
      })
    ).resolves.toBe(STALE);
  });

  it("rethrows errors of the current request", async () => {
    const request = createLatestRequest();
    await expect(
      request.run(async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });

  it("abort() cancels and invalidates the pending request", async () => {
    const request = createLatestRequest();
    const pending = deferred<string>();
    let signal: AbortSignal | undefined;
    const run = request.run((s) => ((signal = s), pending.promise));
    request.abort();
    expect(signal?.aborted).toBe(true);
    pending.resolve("late");
    await expect(run).resolves.toBe(STALE);
  });
});
