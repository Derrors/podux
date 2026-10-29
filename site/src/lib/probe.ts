/** Parses a probe timestamp ("2006-01-02 15:04:05.000Z", UTC) into a Date. */
export function parseProbeTime(t: string): Date {
  return new Date(t.replace(" ", "T").replace(/Z$/, "+00:00"));
}
