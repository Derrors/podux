import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const src = resolve(__dirname, "..");
const entry = readFileSync(join(src, "styles.radix.css"), "utf8");
const imports = [...entry.matchAll(/@import "([^"]+)"/g)].map((match) => match[1]);
const themeRoot = resolve(require.resolve("@radix-ui/themes/package.json"), "..");
const available = readdirSync(join(themeRoot, "tokens/colors")).map((file) =>
  file.replace(".css", "")
);
const included = new Set(
  imports.map((path) => path.match(/colors\/([a-z]+)\.css/)?.[1]).filter(Boolean)
);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : /\.(tsx?|css)$/.test(entry.name) && !entry.name.includes(".test.")
        ? [join(dir, entry.name)]
        : []
  );
}

describe("Radix CSS entry", () => {
  it("uses real package exports and preserves all component/base/responsive utility styles", () => {
    for (const path of imports) expect(() => require.resolve(path)).not.toThrow();
    expect(imports).toContain("@radix-ui/themes/tokens/base.css");
    expect(imports).toContain("@radix-ui/themes/components.css");
    expect(imports).toContain("@radix-ui/themes/utilities.css");
    const main = readFileSync(join(src, "main.tsx"), "utf8");
    expect(main).toContain('import "./styles.radix.css"');
    expect(main).not.toContain("@radix-ui/themes/styles.css");
  });

  it("covers every referenced color, including dynamic ternaries, maps and template scales", () => {
    // Scan all string literals, not just color= props: this catches statusColor maps,
    // dynamic var(--${scale}-*) scales, icon colors and reusable component color unions.
    const missing = new Set<string>();
    for (const file of files(src)) {
      const source = readFileSync(file, "utf8");
      for (const color of available) {
        const literal = new RegExp(`['"\x60]${color}['"\x60]`);
        const token = new RegExp(`--${color}-(?:a?\\d|contrast|surface|indicator|track)`);
        if ((literal.test(source) || token.test(source)) && !included.has(color))
          missing.add(color);
      }
    }
    expect([...missing]).toEqual([]);
    expect(included.size).toBeLessThan(available.length);
  });
});
