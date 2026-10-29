import { useEffect, useState } from "react";
import { createLatestRequest } from "../lib/latestRequest";

/** A per-component LatestRequest that aborts its in-flight request on unmount. */
export function useLatestRequest() {
  const [request] = useState(createLatestRequest);
  useEffect(() => () => request.abort(), [request]);
  return request;
}
