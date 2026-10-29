import { useCallback, useState } from "react";
import { apiGet } from "../../lib/api";
import { STALE } from "../../lib/latestRequest";
import { useLatestRequest } from "../../hooks/useLatestRequest";
import { usePolling } from "../../hooks/usePolling";
import type { ProbePoint } from "../../types/server";

const POLL_INTERVAL_MS = 30_000;

export interface ProbeHistoryState {
  points: ProbePoint[];
  /** Time of the last successful fetch; anchors the 30-minute window. */
  fetchedAt: number;
  loading: boolean;
}

/** Last 30 minutes of probe results for one server, shared by ProbeHistory and LatencyChart. */
export function useProbeHistory(serverId: string | undefined): ProbeHistoryState {
  const [state, setState] = useState<ProbeHistoryState>({ points: [], fetchedAt: 0, loading: true });
  const request = useLatestRequest();

  const load = useCallback(async () => {
    if (!serverId) return;
    let points: ProbePoint[] | null | typeof STALE | undefined;
    try {
      points = await request.run((signal) =>
        apiGet<ProbePoint[] | null>(
          `/api/servers/probe-history?serverId=${encodeURIComponent(serverId)}`,
          { signal }
        )
      );
    } catch {
      // Background chart data: keep the last good points and retry on the next poll.
      points = undefined;
    }
    if (points === STALE) return;
    if (points === undefined) {
      setState((prev) => ({ ...prev, loading: false }));
    } else {
      setState({ points: points ?? [], fetchedAt: Date.now(), loading: false });
    }
  }, [serverId, request]);

  usePolling(load, POLL_INTERVAL_MS, { immediate: true, enabled: !!serverId, restartKey: serverId });

  return state;
}
