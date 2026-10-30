import type { TFunction } from "i18next";

/**
 * Format a timestamp into a localized "time ago" string ("5 minutes ago", "5 分钟前").
 * @param timestamp - ISO date string or Date object
 * @param locale - current UI language (i18n.language)
 */
export const formatTimeAgo = (
  timestamp: string | Date | null | undefined,
  locale: string,
  t: TFunction
): string => {
  if (!timestamp) return t("time.never");

  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  // Future dates and anything under a minute
  if (diffMinutes < 1) return t("time.justNow");

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 60) return rtf.format(-diffMinutes, "minute");
  if (diffHours < 24) return rtf.format(-diffHours, "hour");
  if (diffDays < 30) return rtf.format(-diffDays, "day");
  if (diffDays < 365) return rtf.format(-Math.floor(diffDays / 30), "month");
  return rtf.format(-Math.floor(diffDays / 365), "year");
};

/** Human readable byte count ("1.5 MB"), base 1024. */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
};

/** Compact remaining time ("45m", "5h", "3d") for a positive duration in ms. */
export const formatDuration = (ms: number): string => {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};
