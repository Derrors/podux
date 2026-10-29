import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import { getIcons } from "@iconify/utils";
import type { Plugin } from "vite";

type IconifyJSON = Parameters<typeof getIcons>[0];

const VIRTUAL_ID = "virtual:iconify-icons";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
// Quoted "prefix:name" literals, e.g. icon="lucide:map-pin" or "circle-flags:us".
const ICON_LITERAL = /["'`]([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)["'`]/g;

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

/** Collects the icon names per prefix referenced as string literals under `srcDir`. */
export function scanIconNames(srcDir: string, prefixes: string[]): Map<string, Set<string>> {
  const used = new Map(prefixes.map((prefix) => [prefix, new Set<string>()]));
  for (const file of listSourceFiles(srcDir)) {
    for (const match of readFileSync(file, "utf8").matchAll(ICON_LITERAL)) {
      used.get(match[1])?.add(match[2]);
    }
  }
  return used;
}

interface IconifyOfflineOptions {
  /** Directory scanned for icon names. */
  srcDir: string;
  /** Icon set prefixes; each needs the matching `@iconify-json/<prefix>` package. */
  prefixes: string[];
}

/**
 * Provides `virtual:iconify-icons`: the subset of each icon set that the source code uses,
 * to be registered with `addCollection` so `@iconify/react/offline` never hits the Iconify API.
 * Icon names must appear as full string literals ("lucide:x"), not built from variables.
 */
export function iconifyOffline({ srcDir, prefixes }: IconifyOfflineOptions): Plugin {
  const require = createRequire(import.meta.url);
  const root = resolve(srcDir);
  const iconSets = new Map<string, IconifyJSON>();
  let lastSignature = "";

  const iconSet = (prefix: string): IconifyJSON => {
    let set = iconSets.get(prefix);
    if (!set) {
      set = require(`@iconify-json/${prefix}/icons.json`) as IconifyJSON;
      iconSets.set(prefix, set);
    }
    return set;
  };

  const signatureOf = (used: Map<string, Set<string>>) =>
    [...used].map(([prefix, names]) => `${prefix}:${[...names].sort().join(",")}`).join(";");

  const generate = () => {
    const used = scanIconNames(root, prefixes);
    lastSignature = signatureOf(used);
    const collections: IconifyJSON[] = [];
    const missing: string[] = [];
    for (const [prefix, names] of used) {
      if (names.size === 0) continue;
      const subset = getIcons(iconSet(prefix), [...names].sort(), true);
      if (!subset) continue;
      for (const name of subset.not_found ?? []) missing.push(`${prefix}:${name}`);
      delete subset.not_found;
      collections.push(subset);
    }
    return { code: `export default ${JSON.stringify(collections)};`, missing };
  };

  return {
    name: "iconify-offline",
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      const { code, missing } = generate();
      for (const name of missing) this.warn(`Unknown icon "${name}"`);
      return code;
    },
    configureServer(server) {
      // Regenerate when a source edit adds or removes an icon.
      const onFileChange = (file: string) => {
        if (!file.startsWith(root) || !SOURCE_EXTENSIONS.has(extname(file))) return;
        if (signatureOf(scanIconNames(root, prefixes)) === lastSignature) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", onFileChange);
      server.watcher.on("change", onFileChange);
    },
  };
}
