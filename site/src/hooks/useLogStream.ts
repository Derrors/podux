import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "../lib/api";
import { newReplayLines } from "../lib/logReplay";
import { parseSseChunk } from "../lib/sse";

/** `empty`: the server has no log file yet (HTTP 404); not retried until `reconnect`. */
export type LogStreamStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "empty";

export interface LogLine {
  id: number;
  text: string;
}

export const MAX_LOG_LINES = 500;
/** Sent by the backend after the replayed history of every connection. */
export const REPLAY_END_EVENT = "replay-end";
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
 * The backend replays up to 50 lines on every connect and then sends a `replay-end`
 * event; the replay is merged into the buffer (see lib/logReplay.ts) so a reconnect
 * neither wipes older lines nor brings back lines the user cleared.
 * Mount it with `key={serverId}` so switching servers starts from a clean state.
 */
export function useLogStream(serverId: string) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<LogStreamStatus>("connecting");
  const [retryToken, setRetryToken] = useState(0);
  const nextIdRef = useRef(0);
  // Source of truth for the buffer outside of render (merging needs the current lines).
  const linesRef = useRef<LogLine[]>([]);
  // Texts that were visible when the user last pressed Clear: the anchor for later replays.
  const clearedRef = useRef<string[]>([]);

  const commit = useCallback((next: LogLine[]) => {
    linesRef.current = next;
    setLines(next);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const append = (texts: string[]) => {
      if (texts.length === 0) return;
      const entries = texts.map((text) => ({ id: nextIdRef.current++, text }));
      commit(appendLogLines(linesRef.current, entries));
    };

    const mergeReplay = (replay: string[]) => {
      const current = linesRef.current;
      const seen = current.length > 0 ? current.map((line) => line.text) : clearedRef.current;
      append(newReplayLines(seen, replay));
    };

    const connect = async () => {
      const startedAt = Date.now();
      // Lines of the replayed history; null once `replay-end` arrived.
      let replay: string[] | null = [];
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
          const live: string[] = [];
          for (const { event, data } of events) {
            if (event === REPLAY_END_EVENT) {
              if (replay) mergeReplay(replay);
              replay = null;
            } else if (replay) {
              replay.push(data);
            } else {
              live.push(data);
            }
          }
          append(live);
        }
      } catch (err) {
        if (signal.aborted) return;
        if (err instanceof ApiError && err.status === 404) {
          setStatus("empty");
          return;
        }
        if (isPermanentFailure(err)) {
          setStatus("disconnected");
          return;
        }
      }
      if (signal.aborted) return;
      // The stream ended before `replay-end`: keep what was replayed so far.
      if (replay && replay.length > 0) mergeReplay(replay);

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
  }, [serverId, retryToken, commit]);

  const clear = useCallback(() => {
    if (linesRef.current.length > 0) {
      clearedRef.current = linesRef.current.map((line) => line.text);
    }
    commit([]);
  }, [commit]);

  const reconnect = useCallback(() => {
    setStatus("connecting");
    setRetryToken((n) => n + 1);
  }, []);

  return { lines, status, clear, reconnect };
}
