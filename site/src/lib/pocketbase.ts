import PocketBase, { type SendOptions } from "pocketbase";

const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL || "/api");

// The SDK auto-cancels a pending request when another one with the same method+path
// starts, which breaks parallel queries against one collection (e.g. a page plus a
// count query). Auto-cancellation is disabled by default here; hooks that need
// race-safety pass an explicit `signal` and ignore stale responses instead
// (see lib/latestRequest.ts).
const _send = pb.send.bind(pb);
pb.send = function <T = unknown>(path: string, options: SendOptions = {}): Promise<T> {
  if (!("requestKey" in options)) {
    options.requestKey = null;
  }
  return _send<T>(path, options);
};

// An expired or revoked token makes the backend answer 401: drop the local auth state
// so RequireAuth redirects to the login page.
pb.afterSend = function (response, data) {
  if (response.status === 401 && pb.authStore.token) {
    pb.authStore.clear();
  }
  return data;
};

export default pb;
