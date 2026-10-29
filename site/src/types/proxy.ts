export interface Proxy {
  id: string;
  serverId: string;
  proxyType: "tcp" | "udp" | "http" | "https";
  name?: string;
  localIP?: string;
  localPort?: string;
  remotePort?: string;
  subdomain?: string;
  customDomains?: string[];
  transport?: Record<string, boolean>;
  description?: string;
  status: "enabled" | "disabled";
  bootStatus: "online" | "offline";
  created: string;
  updated: string;
  expand?: {
    serverId?: { serverName?: string; serverAddr?: string };
  };
}
