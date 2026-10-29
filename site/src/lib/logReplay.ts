/**
 * The log stream replays the last lines of the log file on every (re)connect.
 * `newReplayLines` decides which of those replayed lines the client hasn't seen yet.
 *
 * `seen` is what the user has already seen, oldest first: the current buffer, or, when
 * the buffer is empty after a Clear, the lines that were visible when it was cleared.
 * Its last line is the anchor. The replay is searched backwards for the anchor; when
 * the anchor text occurs more than once, the occurrence whose preceding lines also
 * match `seen` wins (falling back to the last occurrence). Only lines after the anchor
 * are new. Without an anchor (fresh mount) or when it isn't in the replay (rotated
 * log, long disconnect) every replayed line is new.
 */
export function newReplayLines(seen: readonly string[], replay: readonly string[]): string[] {
  if (seen.length === 0) return [...replay];
  const anchor = seen[seen.length - 1];

  let fallback = -1;
  for (let i = replay.length - 1; i >= 0; i--) {
    if (replay[i] !== anchor) continue;
    if (fallback === -1) fallback = i;
    if (matchesBefore(seen, replay, i)) return replay.slice(i + 1);
  }
  return fallback === -1 ? [...replay] : replay.slice(fallback + 1);
}

/** True when the replay lines before `index` agree with the lines before the anchor in `seen`. */
function matchesBefore(seen: readonly string[], replay: readonly string[], index: number): boolean {
  for (let back = 1; back <= index && back < seen.length; back++) {
    if (replay[index - back] !== seen[seen.length - 1 - back]) return false;
  }
  return true;
}
