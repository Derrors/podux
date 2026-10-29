import type { TFunction } from "i18next";

export const formatBytes = (bytes: number): { value: number; unit: string } => {
  if (bytes === 0) return { value: 0, unit: "B" };
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return { value: bytes / Math.pow(k, i), unit: sizes[i] };
};

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
