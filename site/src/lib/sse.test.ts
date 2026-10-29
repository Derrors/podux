import { describe, expect, it } from "vitest";
import { parseSseChunk } from "./sse";

/** Feeds chunks through the parser the way the log stream does. */
function feed(chunks: string[]): string[] {
  const events: string[] = [];
  let rest = "";
  for (const chunk of chunks) {
    const result = parseSseChunk(rest + chunk);
    events.push(...result.events);
    rest = result.rest;
  }
  return events;
}

describe("parseSseChunk", () => {
  it("parses complete frames and keeps the incomplete tail", () => {
    expect(parseSseChunk("data: one\n\ndata: two\n\ndata: thr")).toEqual({
      events: ["one", "two"],
      rest: "data: thr",
    });
  });

  it("handles frames split across chunks at any position", () => {
    const stream = "data: [podux] start proxy\n\ndata: login ok\n\n";
    for (let i = 1; i < stream.length; i++) {
      expect(feed([stream.slice(0, i), stream.slice(i)])).toEqual([
        "[podux] start proxy",
        "login ok",
      ]);
    }
    expect(feed(stream.split(""))).toEqual(["[podux] start proxy", "login ok"]);
  });

  it("supports CRLF and CR line endings, also when split between \\r and \\n", () => {
    expect(feed(["data: a\r\n\r\ndata: b\r\rdata: c\n\n"])).toEqual(["a", "b", "c"]);
    expect(feed(["data: a\r", "\n\r", "\ndata: b\r\n\r\n"])).toEqual(["a", "b"]);
  });

  it("joins multi-line data and strips a single leading space", () => {
    expect(feed(["data: line 1\ndata:line 2\ndata:  indented\n\n"])).toEqual([
      "line 1\nline 2\n indented",
    ]);
  });

  it("ignores comments, other fields and frames without data", () => {
    expect(feed([": keep-alive\n\nevent: log\nid: 7\ndata: x\nretry: 1000\n\n\n\n"])).toEqual([
      "x",
    ]);
  });

  it("keeps empty data lines as empty events", () => {
    expect(feed(["data\n\ndata:\n\n"])).toEqual(["", ""]);
  });
});
