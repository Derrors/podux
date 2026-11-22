/** Bracket IPv6 literals when joining an address and a port. */
export function formatEndpoint(host: string, port?: number | string): string {
  if (!port) return host;
  const address = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${address}:${port}`;
}
