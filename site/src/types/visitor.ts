export interface Visitor {
  id: string;
  serverId: string;
  name: string;
  visitorType: "stcp" | "sudp" | "xtcp";
  /** Name of the proxy to visit as registered on frps. */
  serverName: string;
  serverUser?: string;
  secretKey?: string;
  bindAddr?: string;
  bindPort?: number;
  keepTunnelOpen?: boolean;
  transport?: Record<string, unknown> | null;
  status: "enabled" | "disabled";
  description?: string;
  created: string;
  updated: string;
  expand?: {
    serverId?: { serverName?: string; serverAddr?: string };
  };
}
