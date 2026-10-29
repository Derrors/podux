export interface SseEvent {
  /** Value of the `event:` field; undefined for the default "message" event. */
  event?: string;
  data: string;
}

export interface SseParseResult {
  /** Every complete event in the input. */
  events: SseEvent[];
  /** Trailing incomplete frame; prepend it to the next chunk. */
  rest: string;
}

/** Splits an SSE field line into name and value (one leading space of the value is dropped). */
function parseField(line: string): [string, string] {
  const colon = line.indexOf(":");
  if (colon === -1) return [line, ""];
  const value = line.slice(colon + 1);
  return [line.slice(0, colon), value.startsWith(" ") ? value.slice(1) : value];
}

/**
 * Incremental parser for `text/event-stream` bodies.
 * Feed it `rest + chunk`; frames are separated by a blank line and may be split
 * across chunks. Multiple `data:` lines of one event are joined with "\n".
 * Comments (`:`) and the id/retry fields are ignored. A frame is emitted when it has
 * data or an event name, so a bare `event: x` marker is not lost.
 */
export function parseSseChunk(buffer: string): SseParseResult {
  // A trailing "\r" may be the first half of a "\r\n" split across chunks: keep it raw.
  const pendingCR = buffer.endsWith("\r");
  const normalized = (pendingCR ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, "\n");
  const frames = normalized.split("\n\n");
  const rest = (frames.pop() ?? "") + (pendingCR ? "\r" : "");
  const events: SseEvent[] = [];

  for (const frame of frames) {
    const data: string[] = [];
    let event: string | undefined;
    for (const line of frame.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const [field, value] = parseField(line);
      if (field === "data") data.push(value);
      else if (field === "event") event = value || undefined;
    }
    if (data.length === 0 && event === undefined) continue;
    events.push(event === undefined ? { data: data.join("\n") } : { event, data: data.join("\n") });
  }

  return { events, rest };
}
