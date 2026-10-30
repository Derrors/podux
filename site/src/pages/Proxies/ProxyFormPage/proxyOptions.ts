/**
 * Conversions between fh_proxies records and the proxy form for the parts stored as
 * JSON: `options` (extra frp proxy keys), `plugin` and `expiresAt`. Kept free of React
 * so they can be unit tested.
 */

export interface HeaderRow {
  key: string;
  value: string;
}

/** Form fields backed by fh_proxies.options (see frpc.proxyOptionKeys in the backend). */
export interface OptionFields {
  httpUser: string;
  httpPassword: string;
  hostHeaderRewrite: string;
  locations: string[];
  requestHeaders: HeaderRow[];
  responseHeaders: HeaderRow[];
  routeByHTTPUser: string;
  lbGroup: string;
  lbGroupKey: string;
}

export const EMPTY_OPTIONS: OptionFields = {
  httpUser: "",
  httpPassword: "",
  hostHeaderRewrite: "",
  locations: [],
  requestHeaders: [],
  responseHeaders: [],
  routeByHTTPUser: "",
  lbGroup: "",
  lbGroupKey: "",
};

type Json = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");

const headerRows = (v: unknown): HeaderRow[] => {
  const set = (v as { set?: Record<string, unknown> } | undefined)?.set;
  return set && typeof set === "object"
    ? Object.entries(set).map(([key, value]) => ({ key, value: str(value) }))
    : [];
};

const headerSet = (rows: HeaderRow[]) => {
  const set = Object.fromEntries(
    rows.map((r) => [r.key.trim(), r.value] as const).filter(([k]) => k !== "")
  );
  return Object.keys(set).length > 0 ? { set } : undefined;
};

export function optionsFromRecord(options: Json | null | undefined): OptionFields {
  const o = options ?? {};
  const lb = (o.loadBalancer as Json | undefined) ?? {};
  return {
    httpUser: str(o.httpUser),
    httpPassword: str(o.httpPassword),
    hostHeaderRewrite: str(o.hostHeaderRewrite),
    locations: Array.isArray(o.locations) ? o.locations.map(str).filter(Boolean) : [],
    requestHeaders: headerRows(o.requestHeaders),
    responseHeaders: headerRows(o.responseHeaders),
    routeByHTTPUser: str(o.routeByHTTPUser),
    lbGroup: str(lb.group),
    lbGroupKey: str(lb.groupKey),
  };
}

/** Which option groups apply to a proxy type. */
export const optionSupport = (type: string) => ({
  http: type === "http",
  auth: type === "http" || type === "tcpmux",
  loadBalancer: type === "tcp" || type === "http" || type === "tcpmux",
});

/**
 * Builds fh_proxies.options for the proxy type. Keys the form edits are replaced
 * (and left out when empty or not used by the type); other stored keys are kept.
 */
export function optionsToRecord(type: string, f: OptionFields, loaded: Json = {}): Json {
  const out: Json = { ...loaded };
  const support = optionSupport(type);
  const put = (key: string, value: unknown, applies: boolean) => {
    const empty =
      value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
    if (applies && !empty) out[key] = value;
    else delete out[key];
  };
  put("httpUser", f.httpUser.trim(), support.auth);
  put("httpPassword", f.httpPassword, support.auth);
  put("routeByHTTPUser", f.routeByHTTPUser.trim(), support.auth);
  put("hostHeaderRewrite", f.hostHeaderRewrite.trim(), support.http);
  put("locations", f.locations.map((l) => l.trim()).filter(Boolean), support.http);
  put("requestHeaders", headerSet(f.requestHeaders), support.http);
  put("responseHeaders", headerSet(f.responseHeaders), support.http);
  put(
    "loadBalancer",
    f.lbGroup.trim() ? { group: f.lbGroup.trim(), groupKey: f.lbGroupKey.trim() } : undefined,
    support.loadBalancer
  );
  if (type === "tcpmux") out.multiplexer = "httpconnect";
  else delete out.multiplexer;
  return out;
}

// ── Plugins ──────────────────────────────────────────────────────────────────

export type PluginType =
  | "socks5"
  | "http_proxy"
  | "static_file"
  | "unix_domain_socket"
  | "http2http"
  | "http2https"
  | "https2http"
  | "https2https"
  | "tls2raw";

export interface PluginField {
  key: string;
  /** Locale key under proxy.pluginField. */
  label: string;
  required?: boolean;
  secret?: boolean;
  /** Accepts a PEM certificate/key pasted in, or a path on the Podux host. */
  pem?: boolean;
  placeholder?: string;
}

const LOCAL_ADDR: PluginField = { key: "localAddr", label: "localAddr", required: true, placeholder: "127.0.0.1:8080" };
const HOST_REWRITE: PluginField = { key: "hostHeaderRewrite", label: "hostHeaderRewrite" };
const CRT: PluginField = { key: "crtPath", label: "crtPath", pem: true };
const KEY: PluginField = { key: "keyPath", label: "keyPath", pem: true, secret: true };
const HTTP_USER: PluginField = { key: "httpUser", label: "httpUser" };
const HTTP_PASSWORD: PluginField = { key: "httpPassword", label: "httpPassword", secret: true };

/** Plugin form fields and the proxy types each plugin is offered for. */
export const PLUGIN_SPECS: Record<PluginType, { fields: PluginField[]; proxyTypes: string[] }> = {
  socks5: {
    fields: [{ key: "username", label: "username" }, { key: "password", label: "password", secret: true }],
    proxyTypes: ["tcp", "stcp", "xtcp", "tcpmux"],
  },
  http_proxy: { fields: [HTTP_USER, HTTP_PASSWORD], proxyTypes: ["tcp", "stcp", "xtcp", "tcpmux"] },
  static_file: {
    fields: [
      { key: "localPath", label: "localPath", required: true, placeholder: "/srv/files" },
      { key: "stripPrefix", label: "stripPrefix", placeholder: "static" },
      HTTP_USER,
      HTTP_PASSWORD,
    ],
    proxyTypes: ["tcp", "http", "stcp", "xtcp"],
  },
  unix_domain_socket: {
    fields: [{ key: "unixPath", label: "unixPath", required: true, placeholder: "/var/run/docker.sock" }],
    proxyTypes: ["tcp", "stcp", "xtcp", "tcpmux"],
  },
  http2http: { fields: [LOCAL_ADDR, HOST_REWRITE], proxyTypes: ["http", "tcp"] },
  http2https: { fields: [LOCAL_ADDR, HOST_REWRITE], proxyTypes: ["http", "tcp"] },
  https2http: { fields: [LOCAL_ADDR, HOST_REWRITE, CRT, KEY], proxyTypes: ["https", "tcp"] },
  https2https: { fields: [LOCAL_ADDR, HOST_REWRITE, CRT, KEY], proxyTypes: ["https", "tcp"] },
  tls2raw: { fields: [LOCAL_ADDR, CRT, KEY], proxyTypes: ["https", "tcp"] },
};

export const PLUGIN_TYPES = Object.keys(PLUGIN_SPECS) as PluginType[];

export interface PluginState {
  enabled: boolean;
  type: PluginType;
  fields: Record<string, string>;
}

export function pluginFromRecord(plugin: Json | null | undefined): PluginState {
  const type = str(plugin?.type) as PluginType;
  if (!type || !(type in PLUGIN_SPECS)) return { enabled: false, type: "socks5", fields: {} };
  const fields: Record<string, string> = {};
  for (const f of PLUGIN_SPECS[type].fields) fields[f.key] = str(plugin?.[f.key]);
  return { enabled: true, type, fields };
}

/** fh_proxies.plugin for the form state, or null when off. Other stored keys are kept. */
export function pluginToRecord(p: PluginState, loaded: Json | null | undefined): Json | null {
  if (!p.enabled) return null;
  const out: Json = loaded && str(loaded.type) === p.type ? { ...loaded } : {};
  out.type = p.type;
  for (const f of PLUGIN_SPECS[p.type].fields) {
    const v = (p.fields[f.key] ?? "").trim();
    if (v) out[f.key] = f.pem ? v + (v.includes("-----BEGIN") && !v.endsWith("\n") ? "\n" : "") : v;
    else delete out[f.key];
  }
  return out;
}

/** Field keys of the plugin that are required but empty. */
export function missingPluginFields(p: PluginState): string[] {
  if (!p.enabled) return [];
  return PLUGIN_SPECS[p.type].fields.filter((f) => f.required && !p.fields[f.key]?.trim()).map((f) => f.key);
}

// ── Expiry ───────────────────────────────────────────────────────────────────

export const EXPIRY_CHOICES = ["keep", "none", "1h", "2h", "6h", "1d", "7d", "custom"] as const;
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number];

const HOURS: Partial<Record<ExpiryChoice, number>> = { "1h": 1, "2h": 2, "6h": 6, "1d": 24, "7d": 168 };

/** PocketBase date string ("2006-01-02 15:04:05.000Z") for a moment. */
export const toPbDate = (d: Date) => d.toISOString().replace("T", " ");

/**
 * fh_proxies.expiresAt for an expiry choice: "" for none, `current` for keep, now plus
 * the duration, or the custom local datetime ("YYYY-MM-DDTHH:mm" from an input).
 * Returns null for an invalid or past custom time.
 */
export function expiresAtFor(choice: ExpiryChoice, current: string, custom: string, now = new Date()): string | null {
  if (choice === "keep") return current;
  if (choice === "none") return "";
  if (choice === "custom") {
    const d = new Date(custom);
    return Number.isNaN(d.getTime()) || d <= now ? null : toPbDate(d);
  }
  return toPbDate(new Date(now.getTime() + (HOURS[choice] ?? 0) * 3600_000));
}

/** Milliseconds until a PocketBase date, or null when not set. */
export function msUntil(expiresAt: string | undefined | null, now = Date.now()): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt.replace(" ", "T"));
  return Number.isNaN(t) ? null : t - now;
}
