export interface Proxy {
  id: string;
  serverId: string;
  proxyType: "tcp" | "udp" | "http" | "https" | "stcp" | "sudp" | "xtcp";
  name?: string;
  localIP?: string;
  localPort?: string;
  remotePort?: string;
  subdomain?: string;
  customDomains?: string[];
  transport?: Record<string, unknown>;
  secretKey?: string;
  allowUsers?: string[] | null;
  healthCheck?: HealthCheck | null;
  description?: string;
  status: "enabled" | "disabled";
  bootStatus: "online" | "offline";
  created: string;
  updated: string;
  expand?: {
    serverId?: { serverName?: string; serverAddr?: string };
  };
}

export interface HealthCheck {
  type?: "" | "tcp" | "http";
  path?: string;
  intervalSeconds?: number;
  timeoutSeconds?: number;
  maxFailed?: number;
}

/** Proxy types reached through a visitor instead of a public port or domain. */
export const SECRET_PROXY_TYPES = ["stcp", "sudp", "xtcp"] as const;

export const isSecretProxyType = (type: string) =>
  (SECRET_PROXY_TYPES as readonly string[]).includes(type);

/** Name frpc registers the proxy under on frps; visitors must use it as their server name. */
export const proxyRuntimeName = (proxy: { name?: string; id: string }) => `${proxy.name}-${proxy.id}`;
