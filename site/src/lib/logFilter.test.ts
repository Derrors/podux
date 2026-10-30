import { describe, expect, it } from "vitest";
import { lineLevel, matchesLogFilter } from "./logFilter";

const line = (tag: string, msg: string) => `2026-10-30 10:00:00.000 [${tag}] [client/service.go:1] ${msg}`;

describe("logFilter", () => {
  it("reads the level tag", () => {
    expect(lineLevel(line("W", "x"))).toBe("W");
    expect(lineLevel("plain text")).toBeUndefined();
  });

  it("filters by minimum level and search text", () => {
    expect(matchesLogFilter(line("D", "debug"), "I", "")).toBe(false);
    expect(matchesLogFilter(line("E", "Login FAILED"), "W", "failed")).toBe(true);
    expect(matchesLogFilter(line("I", "ok"), "T", "failed")).toBe(false);
    expect(matchesLogFilter("no level here", "E", "")).toBe(true);
  });
});
