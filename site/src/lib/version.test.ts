import { describe, expect, it } from "vitest";
import { compareVersions, isNewerVersion, parseVersion } from "./version";

describe("isNewerVersion", () => {
  it.each([
    ["v0.2.1", "v0.2.0", true],
    ["0.3.0", "v0.2.9", true],
    ["v1.0.0", "v0.99.99", true],
    ["v0.2.0", "v0.2.0", false],
    ["v0.1.9", "v0.2.0", false],
    // Missing parts count as 0.
    ["v1", "v0.9", true],
    ["v1.0", "v1.0.0", false],
    ["v1.0.1", "v1", true],
    // Releases beat their prereleases.
    ["v0.2.0", "v0.2.0-rc.1", true],
    ["v0.2.0-rc.1", "v0.2.0", false],
    ["v0.2.0-rc.1", "v0.1.9", true],
    // Prerelease identifiers.
    ["v0.2.0-rc.2", "v0.2.0-rc.1", true],
    ["v0.2.0-rc.10", "v0.2.0-rc.2", true],
    ["v0.2.0-rc.1", "v0.2.0-beta.3", true],
    ["v0.2.0-alpha.1", "v0.2.0-alpha", true],
    ["v0.2.0-alpha.beta", "v0.2.0-alpha.1", true],
    ["v0.2.0-rc.1+build.5", "v0.2.0-rc.1", false],
  ])("%s newer than %s: %s", (latest, current, expected) => {
    expect(isNewerVersion(latest, current)).toBe(expected);
  });

  it.each([
    ["latest", "v0.2.0"],
    ["v0.3.0", "dev"],
    ["", "v0.2.0"],
    ["v0.3.x", "v0.2.0"],
    ["v0.3.0-", "v0.2.0"],
    ["v0.3.0-rc..1", "v0.2.0"],
  ])("garbage input %j vs %j is never newer", (latest, current) => {
    expect(isNewerVersion(latest, current)).toBe(false);
    expect(isNewerVersion(current, latest)).toBe(false);
  });

  it("parses and compares", () => {
    expect(parseVersion("v1.2")).toEqual({ core: [1, 2, 0], prerelease: [] });
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("nope", "1.2.3")).toBeNull();
  });
});
