import pb from "./pocketbase";

/**
 * Called when the backend rejects the current token (HTTP 401).
 * Clearing the auth store is enough: RequireAuth subscribes to it and redirects
 * to /login (with a redirect back param). Pages outside RequireAuth (login, setup)
 * are unaffected, so this cannot cause a redirect loop.
 */
export function handleUnauthorized() {
  if (pb.authStore.token || pb.authStore.record) {
    pb.authStore.clear();
  }
}

/** Only allow same-origin absolute paths as post-login redirect targets. */
export function sanitizeRedirect(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }
  if (value.startsWith("/login") || value.startsWith("/setup")) return null;
  return value;
}
