import { describe, expect, it } from "vitest";
import { formatEndpoint } from "./endpoints";

describe("readable endpoint addresses", () => {
  it("keeps names and IPv4 while bracketing IPv6", () => {
    expect(formatEndpoint("example.com", 8080)).toBe("example.com:8080");
    expect(formatEndpoint("127.0.0.1", 22)).toBe("127.0.0.1:22");
    expect(formatEndpoint("::1", 8080)).toBe("[::1]:8080");
    expect(formatEndpoint("[::1]", 8080)).toBe("[::1]:8080");
    expect(formatEndpoint("::1")).toBe("::1");
  });
});
