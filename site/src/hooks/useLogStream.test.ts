import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLogStream } from "./useLogStream";

const fetchMock = vi.fn<typeof fetch>();

/** An SSE response that sends `body` and then stays open (or closes when `close` is set). */
function sseResponse(body: string, close = false) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      if (close) controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const frames = (...lines: string[]) => lines.map((line) => `data: ${line}\n\n`).join("");
const REPLAY_END = "event: replay-end\ndata:\n\n";

/** Lets pending fetch/stream promises settle and runs timers up to `ms`. */
const advance = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useLogStream", () => {
  it("treats 404 (no log file yet) as empty and does not reconnect until asked", async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ error: "log file not found" }), { status: 404 })
    );
    const { result } = renderHook(() => useLogStream("s1"));
    await advance();
    expect(result.current.status).toBe("empty");
    expect(result.current.lines).toEqual([]);

    await advance(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => result.current.reconnect());
    await advance();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("empty");
  });

  it("merges a short replay after a reconnect instead of replacing the buffer", async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse(frames("a", "b") + REPLAY_END + frames("c"), true))
      .mockResolvedValueOnce(sseResponse(frames("c") + REPLAY_END + frames("d")));
    const { result } = renderHook(() => useLogStream("s1"));
    await advance();
    expect(result.current.lines.map((l) => l.text)).toEqual(["a", "b", "c"]);
    expect(result.current.status).toBe("reconnecting");

    await advance(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("connected");
    const lines = result.current.lines;
    expect(lines.map((l) => l.text)).toEqual(["a", "b", "c", "d"]);
    expect(new Set(lines.map((l) => l.id)).size).toBe(lines.length);
  });

  it("does not bring back cleared lines on the next replay", async () => {
    fetchMock
      .mockResolvedValueOnce(sseResponse(frames("a", "b") + REPLAY_END))
      .mockResolvedValueOnce(sseResponse(frames("a", "b") + REPLAY_END + frames("c")));
    const { result } = renderHook(() => useLogStream("s1"));
    await advance();
    expect(result.current.lines.map((l) => l.text)).toEqual(["a", "b"]);

    act(() => result.current.clear());
    act(() => result.current.reconnect());
    await advance();
    expect(result.current.lines.map((l) => l.text)).toEqual(["c"]);
  });
});
