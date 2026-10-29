import { describe, expect, it } from "vitest";
import { newReplayLines } from "./logReplay";

describe("newReplayLines", () => {
  it("uses the whole replay on a fresh mount", () => {
    expect(newReplayLines([], ["a", "b"])).toEqual(["a", "b"]);
    expect(newReplayLines([], [])).toEqual([]);
  });

  it("keeps old lines and appends only what follows the anchor after a reconnect", () => {
    // Buffer holds more history than the (short) replay; nothing is lost or duplicated.
    const buffer = ["l1", "l2", "l3", "l4", "l5"];
    expect(newReplayLines(buffer, ["l4", "l5", "l6"])).toEqual(["l6"]);
    expect(newReplayLines(buffer, ["l5"])).toEqual([]);
  });

  it("does not bring back cleared lines (anchor = last line visible at Clear)", () => {
    const visibleAtClear = ["l1", "l2", "l3"];
    expect(newReplayLines(visibleAtClear, ["l1", "l2", "l3"])).toEqual([]);
    expect(newReplayLines(visibleAtClear, ["l2", "l3", "l4"])).toEqual(["l4"]);
  });

  it("appends every replayed line when the anchor is not in the replay", () => {
    expect(newReplayLines(["old"], ["n1", "n2"])).toEqual(["n1", "n2"]);
  });

  it("disambiguates a repeated anchor with the preceding lines", () => {
    const buffer = ["x", "heartbeat"];
    expect(newReplayLines(buffer, ["x", "heartbeat", "y", "heartbeat"])).toEqual([
      "y",
      "heartbeat",
    ]);
  });

  it("falls back to the last occurrence when no occurrence matches the context", () => {
    expect(newReplayLines(["q", "hb"], ["a", "hb", "b", "hb", "c"])).toEqual(["c"]);
  });
});
