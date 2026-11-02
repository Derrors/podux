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

// jsdom can parse these precompiled entry points, but cannot resolve calc()/var()
// layout. Compare the actual size declarations rather than claiming pixel measurements.
function sizeDeclarations(css: string, selectors: Record<string, string[]>) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  try {
    const rules = Array.from(style.sheet!.cssRules).filter(
      (rule): rule is CSSStyleRule => "selectorText" in rule
    );
    return Object.fromEntries(
      Object.entries(selectors).map(([selector, properties]) => [
        selector,
        Object.fromEntries(
          properties.map((property) => [
            property,
            rules
              .filter((rule) => rule.selectorText === selector)
              .map((rule) => rule.style.getPropertyValue(property).trim())
              .filter(Boolean),
          ])
        ),
      ])
    );
  } finally {
    style.remove();
  }
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

  it("preserves the official font, spacing and component size declarations", () => {
    const selectors = {
      ".radix-themes": [
        "--default-font-size",
        "--default-line-height",
        "--font-size-2",
        "--font-size-3",
        "--font-size-6",
        "--space-2",
        "--space-4",
        "--space-5",
        "--space-6",
        "--space-7",
        "font-size",
        "line-height",
      ],
      ".radix-themes:where([data-scaling='100%'])": ["--scaling"],
      ".rt-Text:where(.rt-r-size-2)": ["font-size", "--line-height"],
      ".rt-Heading:where(.rt-r-size-6)": ["font-size", "--line-height"],
      ".rt-BaseButton:where(.rt-r-size-2)": ["--base-button-height"],
      ".rt-TextFieldRoot:where(.rt-r-size-2)": ["--text-field-height", "font-size"],
      ".rt-Card:where(.rt-r-size-3)": ["--card-padding"],
      ".rt-r-gap-4": ["gap"],
    };
    const official = sizeDeclarations(
      readFileSync(require.resolve("@radix-ui/themes/styles.css"), "utf8"),
      selectors
    );
    const trimmed = sizeDeclarations(
      entry.replace(/@import "([^"]+)";/g, (_, path: string) =>
        readFileSync(require.resolve(path), "utf8")
      ),
      selectors
    );
    // A changed selector must not turn this into a vacuous empty-vs-empty pass.
    for (const properties of Object.values(official)) {
      for (const values of Object.values(properties)) expect(values.length).toBeGreaterThan(0);
    }
    expect(trimmed).toEqual(official);
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
