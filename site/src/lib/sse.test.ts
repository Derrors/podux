import { describe, expect, it } from "vitest";
import { parseSseChunk, type SseEvent } from "./sse";

/** Feeds chunks through the parser the way the log stream does. */
function feed(chunks: string[]): SseEvent[] {
  const events: SseEvent[] = [];
  let rest = "";
  for (const chunk of chunks) {
    const result = parseSseChunk(rest + chunk);
    events.push(...result.events);
    rest = result.rest;
  }
  return events;
}

const data = (...values: string[]) => values.map((value) => ({ data: value }));

describe("parseSseChunk", () => {
  it("parses complete frames and keeps the incomplete tail", () => {
    expect(parseSseChunk("data: one\n\ndata: two\n\ndata: thr")).toEqual({
      events: data("one", "two"),
      rest: "data: thr",
    });
  });

  it("handles frames split across chunks at any position", () => {
    const stream = "data: [podux] start proxy\n\ndata: login ok\n\n";
    for (let i = 1; i < stream.length; i++) {
      expect(feed([stream.slice(0, i), stream.slice(i)])).toEqual(
        data("[podux] start proxy", "login ok")
      );
    }
    expect(feed(stream.split(""))).toEqual(data("[podux] start proxy", "login ok"));
  });

  it("supports CRLF and CR line endings, also when split between \\r and \\n", () => {
    expect(feed(["data: a\r\n\r\ndata: b\r\rdata: c\n\n"])).toEqual(data("a", "b", "c"));
    expect(feed(["data: a\r", "\n\r", "\ndata: b\r\n\r\n"])).toEqual(data("a", "b"));
  });

  it("joins multi-line data and strips a single leading space", () => {
    expect(feed(["data: line 1\ndata:line 2\ndata:  indented\n\n"])).toEqual(
      data("line 1\nline 2\n indented")
    );
  });

  it("ignores comments, id/retry fields and empty frames", () => {
    expect(feed([": keep-alive\n\nid: 7\ndata: x\nretry: 1000\n\n\n\n"])).toEqual(data("x"));
  });

  it("keeps empty data lines as empty events", () => {
    expect(feed(["data\n\ndata:\n\n"])).toEqual(data("", ""));
  });

  it("returns the event name with the data", () => {
    expect(feed(["event: log\nid: 7\ndata: x\n\n"])).toEqual([{ event: "log", data: "x" }]);
    expect(feed(["event:replay-end\n\n"])).toEqual([{ event: "replay-end", data: "" }]);
  });

  it("parses the replay-end marker between log lines when split at any position", () => {
    const stream = "data: old 1\n\ndata: old 2\n\nevent: replay-end\ndata:\n\ndata: live\n\n";
    const expected = [
      { data: "old 1" },
      { data: "old 2" },
      { event: "replay-end", data: "" },
      { data: "live" },
    ];
    for (let i = 1; i < stream.length; i++) {
      expect(feed([stream.slice(0, i), stream.slice(i)])).toEqual(expected);
    }
    expect(feed(stream.split(""))).toEqual(expected);
  });
});
