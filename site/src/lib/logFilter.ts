/** frp log levels in order, as the one-letter tag frp writes ("[I]"). */
export const LOG_LEVELS = ["T", "D", "I", "W", "E"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RE = / \[([TDIWE])\] /;

/** The level tag of an frp log line, or undefined for lines without one. */
export function lineLevel(line: string): LogLevel | undefined {
  return LEVEL_RE.exec(line)?.[1] as LogLevel | undefined;
}

/**
 * Whether a line passes the viewer's filters: at or above `minLevel` (lines without a
 * level always pass) and containing `search`, case-insensitively.
 */
export function matchesLogFilter(line: string, minLevel: LogLevel, search: string): boolean {
  const level = lineLevel(line);
  if (level && LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(minLevel)) return false;
  return !search || line.toLowerCase().includes(search.toLowerCase());
}
