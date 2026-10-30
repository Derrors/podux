import { describe, expect, it } from "vitest";
import {
  EMPTY_OPTIONS,
  expiresAtFor,
  missingPluginFields,
  msUntil,
  optionsFromRecord,
  optionsToRecord,
  pluginFromRecord,
  pluginToRecord,
} from "./proxyOptions";

describe("options", () => {
  const stored = {
    httpUser: "u",
    httpPassword: "p",
    hostHeaderRewrite: "internal",
    locations: ["/api"],
    requestHeaders: { set: { "X-From": "podux" } },
    loadBalancer: { group: "web", groupKey: "k" },
    proxyProtocolVersion: "v2", // a key the form doesn't edit
  };

  it("round-trips the keys the form edits and keeps the others", () => {
    const fields = optionsFromRecord(stored);
    expect(fields.requestHeaders).toEqual([{ key: "X-From", value: "podux" }]);
    expect(fields.lbGroup).toBe("web");
    expect(optionsToRecord("http", fields, stored)).toEqual(stored);
  });

  it("drops keys the proxy type can't use", () => {
    const out = optionsToRecord("tcp", optionsFromRecord(stored), stored);
    expect(out).toEqual({ loadBalancer: { group: "web", groupKey: "k" }, proxyProtocolVersion: "v2" });
  });

  it("forces the tcpmux multiplexer and omits empty values", () => {
    expect(optionsToRecord("tcpmux", { ...EMPTY_OPTIONS, requestHeaders: [{ key: " ", value: "x" }] })).toEqual({
      multiplexer: "httpconnect",
    });
  });
});

describe("plugins", () => {
  it("reads only known plugin types", () => {
    expect(pluginFromRecord({ type: "virtual_net" }).enabled).toBe(false);
    expect(pluginFromRecord(null).enabled).toBe(false);
    const p = pluginFromRecord({ type: "https2http", localAddr: "127.0.0.1:80", enableHTTP2: false });
    expect(p).toMatchObject({ enabled: true, type: "https2http", fields: { localAddr: "127.0.0.1:80", crtPath: "" } });
  });

  it("writes the plugin, keeping unknown keys of the same type", () => {
    const loaded = { type: "https2http", enableHTTP2: false, crtPath: "/old" };
    const p = pluginFromRecord(loaded);
    p.fields.crtPath = "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----";
    p.fields.localAddr = " 127.0.0.1:80 ";
    expect(pluginToRecord(p, loaded)).toEqual({
      type: "https2http",
      enableHTTP2: false,
      localAddr: "127.0.0.1:80",
      crtPath: "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n",
    });
    expect(pluginToRecord({ ...p, enabled: false }, loaded)).toBeNull();
  });

  it("lists missing required fields", () => {
    expect(missingPluginFields({ enabled: true, type: "static_file", fields: {} })).toEqual(["localPath"]);
    expect(missingPluginFields({ enabled: true, type: "socks5", fields: {} })).toEqual([]);
  });
});

describe("expiry", () => {
  const now = new Date("2026-10-30T12:00:00Z");

  it("computes expiresAt for each choice", () => {
    expect(expiresAtFor("keep", "2026-11-01 00:00:00.000Z", "", now)).toBe("2026-11-01 00:00:00.000Z");
    expect(expiresAtFor("none", "x", "", now)).toBe("");
    expect(expiresAtFor("2h", "", "", now)).toBe("2026-10-30 14:00:00.000Z");
    expect(expiresAtFor("custom", "", "2026-10-30T11:00", now)).toBeNull(); // in the past
    expect(expiresAtFor("custom", "", "not a date", now)).toBeNull();
  });

  it("measures time left", () => {
    expect(msUntil("2026-10-30 12:30:00.000Z", now.getTime())).toBe(30 * 60_000);
    expect(msUntil("", now.getTime())).toBeNull();
  });
});
