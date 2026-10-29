export type ServerBootStatus = "running" | "stopped" | (string & {});

export interface NetworkStatus {
  latency: number;
  reachable: boolean;
  lastCheckTime: string;
  error?: string;
}

export interface GeoLocation {
  country: string;
  countryCode: string;
  region: string;
  city: string;
  isp: string;
  lat: number;
  lon: number;
}

/** Item of the custom `/api/servers` list endpoint (no auth/transport/log/metadatas). */
export interface ServerListItem {
  id: string;
  serverName: string;
  user: string;
  serverAddr: string;
  serverPort: number;
  description: string;
  bootStatus: ServerBootStatus;
  autoConnection: boolean;
  created: string;
  updated: string;
  sendRate: number;
  recvRate: number;
  networkStatus?: NetworkStatus;
  geoLocation?: GeoLocation;
}

export interface ServerListResponse {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: ServerListItem[];
}

/** Full `fh_servers` record as returned by the PocketBase collection API. */
export interface ServerRecord extends Omit<ServerListItem, "networkStatus" | "sendRate" | "recvRate"> {
  serverVersion?: string;
  log?: {
    level: "trace" | "debug" | "info" | "warn" | "error";
    maxDays: number;
    to?: string;
  };
  auth?: {
    method: "none" | "token" | "oidc";
    token: string;
    oidcClientId: string;
    oidcClientSecret: string;
    oidcAudience: string;
    oidcTokenEndpoint: string;
  };
  transport?: {
    protocol: "tcp" | "kcp" | "quic" | "websocket" | "wss";
    tls: {
      enable: boolean;
      disableCustomTLSFirstByte: boolean;
      certFile: string;
      keyFile: string;
      trustedCaFile: string;
      serverName: string;
    };
    proxyURL: string;
  };
  metadatas?: Record<string, string>;
}

/** Point of `/api/servers/probe-history`; `val < 0` means unreachable. */
export interface ProbePoint {
  t: string;
  val: number;
}
