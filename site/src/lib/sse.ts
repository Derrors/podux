export interface SseParseResult {
  /** `data` payloads of every complete event in the input. */
  events: string[];
  /** Trailing incomplete frame; prepend it to the next chunk. */
  rest: string;
}

/**
 * Incremental parser for `text/event-stream` bodies.
 * Feed it `rest + chunk`; frames are separated by a blank line and may be split
 * across chunks. Multiple `data:` lines of one event are joined with "\n";
 * comments (`:`) and other fields (event/id/retry) are ignored.
 */
export function parseSseChunk(buffer: string): SseParseResult {
  // A trailing "\r" may be the first half of a "\r\n" split across chunks: keep it raw.
  const pendingCR = buffer.endsWith("\r");
  const normalized = (pendingCR ? buffer.slice(0, -1) : buffer).replace(/\r\n?/g, "\n");
  const frames = normalized.split("\n\n");
  const rest = (frames.pop() ?? "") + (pendingCR ? "\r" : "");
  const events: string[] = [];

  for (const frame of frames) {
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line === "data") {
        data.push("");
      } else if (line.startsWith("data:")) {
        const value = line.slice(5);
        data.push(value.startsWith(" ") ? value.slice(1) : value);
      }
    }
    if (data.length > 0) events.push(data.join("\n"));
  }

  return { events, rest };
}
