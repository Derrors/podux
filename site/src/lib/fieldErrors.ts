import { ClientResponseError } from "pocketbase";
import type { TFunction } from "i18next";

interface FieldError {
  code?: string;
  message?: string;
  params?: Record<string, unknown>;
}

/** Locale keys for the backend's conflict validation codes (application/proxy/conflicts.go). */
const CODE_KEYS: Record<string, string> = {
  validation_port_conflict: "conflict.port",
  validation_domain_conflict: "conflict.domain",
  validation_bind_conflict: "conflict.bind",
};

/**
 * Per-field messages of a PocketBase 400 validation error, translated for codes
 * Podux knows and the backend message otherwise. Empty for any other error.
 */
export function fieldErrors(err: unknown, t: TFunction): Record<string, string> {
  if (!(err instanceof ClientResponseError) || err.status !== 400) return {};
  const data = (err.response as { data?: Record<string, FieldError> } | undefined)?.data;
  const out: Record<string, string> = {};
  for (const [field, e] of Object.entries(data ?? {})) {
    const key = e.code ? CODE_KEYS[e.code] : undefined;
    out[field] = key ? t(key, { name: String(e.params?.name ?? "") }) : e.message || e.code || "";
  }
  return out;
}

/** The first field message of a validation error (see fieldErrors), or undefined. */
export function firstFieldError(err: unknown, t: TFunction): string | undefined {
  return Object.values(fieldErrors(err, t)).find(Boolean);
}

/**
 * Message for a failed POST /api/proxies/batch: names the proxy and, for a conflict,
 * the proxy it collides with. Undefined for errors without a proxy name.
 */
export function batchErrorMessage(err: unknown, t: TFunction): string | undefined {
  const data = (err as { data?: { proxy?: string; code?: string; params?: Record<string, unknown>; error?: string } })?.data;
  if (!data?.proxy) return undefined;
  const key = data.code ? CODE_KEYS[data.code] : undefined;
  const detail = key ? t(key, { name: String(data.params?.name ?? "") }) : (data.error ?? "");
  return t("proxy.batchFailedOn", { proxy: data.proxy, detail });
}
