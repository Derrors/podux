import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getIconData } from "@iconify/utils";
import { scanIconNames } from "../../vite-plugins/iconify-offline";
import en from "../locales/en.json";
import zh from "../locales/zh.json";

const SRC = resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === "object"
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

describe("offline icons", () => {
  it("every referenced icon exists in the bundled icon sets", () => {
    const prefixes = ["lucide", "circle-flags"];
    const used = scanIconNames(SRC, prefixes);
    const missing: string[] = [];
    for (const [prefix, names] of used) {
      const set = require(`@iconify-json/${prefix}/icons.json`);
      for (const name of names) if (!getIconData(set, name)) missing.push(`${prefix}:${name}`);
    }
    expect(missing).toEqual([]);
    expect(used.get("lucide")?.size).toBeGreaterThan(10);
  });

  it("no component imports the online @iconify/react entry", () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      /from ["']@iconify\/react["']/.test(readFileSync(file, "utf8"))
    );
    expect(offenders).toEqual([]);
  });
});

describe("locales", () => {
  it("en and zh define the same keys", () => {
    const enKeys = new Set(flatten(en));
    const zhKeys = new Set(flatten(zh));
    expect([...enKeys].filter((k) => !zhKeys.has(k))).toEqual([]);
    expect([...zhKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it("every literal t() key exists", () => {
    const keys = new Set(flatten(en));
    const missing = new Set<string>();
    for (const file of sourceFiles(SRC)) {
      for (const match of readFileSync(file, "utf8").matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)) {
        if (!keys.has(match[1])) missing.add(match[1]);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
