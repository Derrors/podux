import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "../lib/api";
import { parseSseChunk } from "../lib/sse";

export type LogStreamStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface LogLine {
  id: number;
  text: string;
}

export const MAX_LOG_LINES = 500;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
/** A connection that stayed open this long resets the backoff. */
const STABLE_CONNECTION_MS = 10_000;

export function backoffDelay(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
}

export function appendLogLines(prev: LogLine[], next: LogLine[], max = MAX_LOG_LINES): LogLine[] {
  const merged = prev.length === 0 ? next : [...prev, ...next];
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

/** Client errors other than timeouts/rate limits won't fix themselves by retrying. */
function isPermanentFailure(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 408 &&
    err.status !== 429
  );
}

/**
 * Streams `/api/frpc/logs/stream` for a server using fetch (so the Authorization header
 * can be sent) and reconnects with exponential backoff when the stream ends or fails.
 * The backend replays the last 50 lines on every connect, so the buffer is replaced by
 * the first batch of each connection instead of appended to.
 * Mount it with `key={serverId}` so switching servers starts from a clean state.
 */
export function useLogStream(serverId: string) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<LogStreamStatus>("connecting");
  const [retryToken, setRetryToken] = useState(0);
  const nextIdRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      const startedAt = Date.now();
      let firstBatch = true;
      try {
        const response = await apiFetch(
          `/api/frpc/logs/stream?id=${encodeURIComponent(serverId)}`,
          { signal, cache: "no-store", headers: { Accept: "text/event-stream" } }
        );
        if (!response.body) throw new Error("Empty log stream");
        setStatus("connected");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const { events, rest } = parseSseChunk(buffer + decoder.decode(value, { stream: true }));
          buffer = rest;
          if (events.length === 0) continue;
          const entries = events.map((text) => ({ id: nextIdRef.current++, text }));
          const replace = firstBatch;
          firstBatch = false;
          setLines((prev) => appendLogLines(replace ? [] : prev, entries));
        }
      } catch (err) {
        if (signal.aborted) return;
        if (isPermanentFailure(err)) {
          setStatus("disconnected");
          return;
        }
      }
      if (signal.aborted) return;

      if (Date.now() - startedAt >= STABLE_CONNECTION_MS) attempt = 0;
      setStatus("reconnecting");
      timer = setTimeout(connect, backoffDelay(attempt));
      attempt++;
    };

    void connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [serverId, retryToken]);

  const clear = useCallback(() => setLines([]), []);

  const reconnect = useCallback(() => {
    setStatus("connecting");
    setRetryToken((n) => n + 1);
  }, []);

  return { lines, status, clear, reconnect };
}
