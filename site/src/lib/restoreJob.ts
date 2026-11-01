import { ApiError } from "./api";

export interface RestoreJob {
  id: string;
  state: "queued" | "running" | "restarting" | "succeeded" | "failed";
  error?: string;
}

export class RestoreTimeoutError extends Error {}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    function abort() { clearTimeout(timer); reject(signal.reason); }
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** A healthy old process is not a restored process. Only a persisted job result
 * can confirm completion, including a fast restart we never saw go offline.
 * This capability request intentionally omits the obsolete login credentials.
 */
export async function waitForRestore(
  id: string,
  signal: AbortSignal,
  timeoutMs = 30 * 60_000,
): Promise<RestoreJob> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const request = new AbortController();
    const abort = () => request.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => request.abort(), Math.min(5000, deadline - Date.now()));
    try {
      const response = await fetch("/api/system/backups/restore-status", {
        headers: { "X-Podux-Restore-ID": id },
        signal: request.signal,
        cache: "no-store",
        credentials: "omit",
      });
      if (response.status === 404) throw new ApiError(404, "restore_status_unavailable");
      if (response.ok) {
        const job: RestoreJob = await response.json();
        if (job.id !== id) throw new ApiError(502, "restore_status_unavailable");
        if (job.state === "succeeded" || job.state === "failed") return job;
      }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ApiError) throw error;
      // Network errors and transient gateway responses are expected during exec.
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
    const remaining = deadline - Date.now();
    if (remaining > 0) await delay(Math.min(1500, remaining), signal);
  }
  throw new RestoreTimeoutError("restore_timeout");
}
