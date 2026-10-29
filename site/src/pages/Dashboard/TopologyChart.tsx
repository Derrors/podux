import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Flex, Text, useThemeContext } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import type { TopologyData } from "./useDashboard";

// ── Layout ────────────────────────────────────────────────────────────────────
const VISITOR_W = 112;
const VISITOR_H = 90;
const SERVER_W = 158;
const SERVER_H = 92;
const PROXY_W = 150;
const PROXY_H = 92;
const LOCAL_W = 140;
const LOCAL_H = 68;
const ROW_H = 112; // row height (node height + gap)

// Column left-edge X positions
const COL = {
  visitor: 0,
  server: 160, // VISITOR_W + 48
  proxy: 400, // server + SERVER_W + 82
  local: 638, // proxy  + PROXY_W  + 88
};

// ── Colours ───────────────────────────────────────────────────────────────────
// Radix CSS variables resolve per theme (light/dark), so nodes, edges and the
// canvas follow the app appearance without a separate palette.
const C = {
  // edge colours
  eVisitor: "var(--accent-9)", // visitor → server : accent (decorative)
  eOn: "var(--green-9)", // any active edge  : green
  eOff: "var(--gray-9)", // any inactive edge: gray

  // proxy type (same scale as the dashboard pie chart)
  tcp: "var(--blue-9)",
  udp: "var(--green-9)",
  http: "var(--orange-9)",
  https: "var(--purple-9)",
} as const;

const TYPE_COLORS: Record<string, string> = { tcp: C.tcp, udp: C.udp, http: C.http, https: C.https };

function typeColor(t: string): string {
  return TYPE_COLORS[t.toLowerCase()] ?? "var(--gray-9)";
}

const P = {
  bg: "var(--color-panel-solid)",
  text: "var(--gray-12)",
  sub: "var(--gray-11)",
  border: "var(--gray-6)",
  pageBg: "var(--gray-2)",
  dot: "var(--gray-7)",
};

// Shared
function StatusPill({ online, labels }: { online: boolean; labels: [string, string] }) {
  const scale = online ? "green" : "red";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 7px",
        borderRadius: 999,
        fontSize: 9,
        fontWeight: 700,
        background: `var(--${scale}-a3)`,
        color: `var(--${scale}-11)`,
        border: `1px solid var(--${scale}-a7)`,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: `var(--${scale}-9)` }} />
      {online ? labels[0] : labels[1]}
    </span>
  );
}

function NodeCard({
  w,
  h,
  accentColor,
  children,
  targetPos,
  targetColor,
  sourcePos,
  sourceColor,
}: {
  w: number;
  h: number;
  accentColor: string;
  children: React.ReactNode;
  targetPos?: Position;
  targetColor?: string;
  sourcePos?: Position;
  sourceColor?: string;
}) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 10,
        boxSizing: "border-box",
        border: `1.5px solid ${P.border}`,
        borderLeft: `3px solid ${accentColor}`,
        background: P.bg,
        display: "flex",
        flexDirection: "column",
        padding: "8px 10px",
        gap: 4,
        boxShadow: "var(--shadow-1)",
      }}
    >
      {targetPos !== undefined && (
        <Handle
          type="target"
          position={targetPos}
          style={{ background: targetColor, border: "none", width: 8, height: 8 }}
        />
      )}
      {sourcePos !== undefined && (
        <Handle
          type="source"
          position={sourcePos}
          style={{ background: sourceColor, border: "none", width: 8, height: 8 }}
        />
      )}
      {children}
    </div>
  );
}

// Visitor Node
function VisitorNode() {
  const { t } = useTranslation();
  return (
    <div
      style={{
        width: VISITOR_W,
        height: VISITOR_H,
        borderRadius: 12,
        boxSizing: "border-box",
        border: "2px solid var(--accent-a6)",
        background: "var(--accent-a2)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
      }}
    >
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: C.eOn, border: "none", width: 8, height: 8 }}
      />
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: "var(--accent-a3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon icon="lucide:users" width={18} height={18} color={C.eVisitor} />
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: P.text }}>
          {t("dashboard.topologyVisitors")}
        </div>
        <div style={{ fontSize: 9, color: P.sub }}>{t("dashboard.topologyInternet")}</div>
      </div>
    </div>
  );
}

// Server Node
function ServerNode({ data }: { data: Record<string, string> }) {
  const { t } = useTranslation();
  const online = data.bootStatus === "running";
  const accent = online ? C.eOn : C.eOff;
  const handleColor = online ? C.eOn : C.eOff;
  return (
    <NodeCard
      w={SERVER_W}
      h={SERVER_H}
      accentColor={accent}
      targetPos={Position.Left}
      targetColor={handleColor}
      sourcePos={Position.Right}
      sourceColor={handleColor}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon icon="lucide:server" width={13} height={13} color={P.sub} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: P.text,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {data.serverName}
        </span>
      </div>
      <span
        style={{
          fontSize: 10,
          color: P.sub,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {data.serverAddr}
      </span>
      <StatusPill online={online} labels={[t("server.running"), t("server.stopped")]} />
    </NodeCard>
  );
}

// Proxy Node
function ProxyNode({ data }: { data: Record<string, string> }) {
  const { t } = useTranslation();
  const online = data.bootStatus === "online";
  const tc = typeColor(data.proxyType);
  const handleColor = online ? C.eOn : C.eOff;
  return (
    <NodeCard
      w={PROXY_W}
      h={PROXY_H}
      accentColor={online ? C.eOn : C.eOff}
      targetPos={Position.Left}
      targetColor={handleColor}
      sourcePos={Position.Right}
      sourceColor={handleColor}
    >
      {/* icon + name */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon icon="lucide:network" width={13} height={13} color={P.sub} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: P.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {data.name}
        </span>
      </div>
      {/* protocol + port */}
      <span style={{ fontSize: 10, color: P.sub }}>
        <span style={{ color: tc, fontWeight: 700 }}>{data.proxyType.toUpperCase()}</span>
        {data.remotePort && <span style={{ fontFamily: "monospace" }}> :{data.remotePort}</span>}
      </span>
      {/* status */}
      <StatusPill online={online} labels={[t("proxy.online"), t("proxy.offline")]} />
    </NodeCard>
  );
}

// ── Local Service Node ────────────────────────────────────────────────────────
function LocalServiceNode({ data }: { data: Record<string, string> }) {
  const { t } = useTranslation();
  return (
    <NodeCard
      w={LOCAL_W}
      h={LOCAL_H}
      accentColor={C.eOn}
      targetPos={Position.Left}
      targetColor={C.eOn}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon icon="lucide:hard-drive" width={13} height={13} color={P.sub} />
        <span style={{ fontSize: 10, fontWeight: 700, color: P.text }}>
          {t("dashboard.topologyLocalService")}
        </span>
      </div>
      <span style={{ fontSize: 11, color: P.sub, fontFamily: "monospace" }}>
        {data.localIP}:{data.localPort}
      </span>
    </NodeCard>
  );
}

const nodeTypes = {
  visitor: VisitorNode,
  server: ServerNode,
  proxy: ProxyNode,
  localService: LocalServiceNode,
};

// Edge
function mkEdge(id: string, source: string, target: string, color: string, active: boolean): Edge {
  return {
    id,
    source,
    target,
    type: "smoothstep",
    animated: active,
    style: {
      stroke: active ? color : C.eOff,
      strokeWidth: active ? 2 : 1.5,
      strokeDasharray: active ? undefined : "5 4",
    },
  };
}

// Main
interface TopologyChartProps {
  topology: TopologyData;
}

export function TopologyChart({ topology }: TopologyChartProps) {
  const { t } = useTranslation();
  const themeCtx = useThemeContext();
  const isDark = themeCtx.appearance === "dark";
  const { servers, proxies } = topology;

  const { nodes, edges, totalRows } = useMemo(() => {
    if (servers.length === 0) return { nodes: [], edges: [], totalRows: 0 };

    // group proxies by server
    const groups = new Map<string, typeof proxies>();
    for (const px of proxies) {
      if (!groups.has(px.serverId)) groups.set(px.serverId, []);
      groups.get(px.serverId)!.push(px);
    }

    // build row assignments
    const serverRows: Array<{
      server: (typeof servers)[0];
      sProxies: typeof proxies;
      startRow: number;
      rowCount: number;
    }> = [];
    let row = 0;
    for (const server of servers) {
      const sProxies = groups.get(server.id) ?? [];
      const rowCount = Math.max(sProxies.length, 1);
      serverRows.push({ server, sProxies, startRow: row, rowCount });
      row += rowCount;
    }
    const totalRows = row;

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    
    // Visitor node — vertically centred over all content
    const visitorY = (totalRows * ROW_H) / 2 - VISITOR_H / 2;
    nodes.push({
      id: "visitor",
      type: "visitor",
      position: { x: COL.visitor, y: visitorY },
      data: {},
      draggable: false,
    });

    for (const { server, sProxies, startRow, rowCount } of serverRows) {
      const serverOnline = server.bootStatus === "running";
      const serverCY = (startRow + rowCount / 2) * ROW_H;
      const serverY = serverCY - SERVER_H / 2;

      // Server node
      nodes.push({
        id: server.id,
        type: "server",
        position: { x: COL.server, y: serverY },
        data: {
          serverName: server.serverName,
          serverAddr: server.serverAddr,
          bootStatus: server.bootStatus,
        },
        draggable: false,
      });

      // Visitor → Server
      edges.push(mkEdge(`e-vis-${server.id}`, "visitor", server.id, C.eOn, serverOnline));

      if (sProxies.length === 0) continue;

      sProxies.forEach((px, pi) => {
        const proxyOnline = px.bootStatus === "online";
        const rowCY = (startRow + pi) * ROW_H + ROW_H / 2;
        const proxyY = rowCY - PROXY_H / 2;
        const localY = rowCY - LOCAL_H / 2;
        const localId = `local-${px.id}`;

        // Proxy node
        nodes.push({
          id: px.id,
          type: "proxy",
          position: { x: COL.proxy, y: proxyY },
          data: {
            name: px.name,
            proxyType: px.proxyType,
            remotePort: px.remotePort,
            status: px.status,
            bootStatus: px.bootStatus,
            },
          draggable: false,
        });

        // Local service node
        nodes.push({
          id: localId,
          type: "localService",
          position: { x: COL.local, y: localY },
          data: {
            localIP: px.localIP,
            localPort: px.localPort,
            bootStatus: px.bootStatus,
            },
          draggable: false,
        });

        // Server → Proxy (tunnel)
        edges.push(
          mkEdge(`e-${server.id}-${px.id}`, server.id, px.id, C.eOn, serverOnline && proxyOnline)
        );
        // Proxy → Local Service
        edges.push(mkEdge(`e-${px.id}-${localId}`, px.id, localId, C.eOn, proxyOnline));
      });
    }

    return { nodes, edges, totalRows };
  }, [servers, proxies]);

  if (servers.length === 0) {
    return (
      <Flex direction="column" align="center" justify="center" gap="3" style={{ height: 240 }}>
        <Icon icon="lucide:network" color="var(--gray-7)" width="56" height="56" />
        <Flex direction="column" align="center" gap="1">
          <Text size="3" weight="medium" color="gray">
            {t("dashboard.topologyEmpty")}
          </Text>
          <Text size="2" color="gray">
            {t("dashboard.topologyEmptyDesc")}
          </Text>
        </Flex>
      </Flex>
    );
  }

  const containerH = Math.max(480, Math.min(900, totalRows * ROW_H + 80));

  return (
    <div style={{ height: containerH, borderRadius: 8, overflow: "hidden" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={isDark ? "dark" : "light"}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        minZoom={0.25}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        style={{ background: P.pageBg }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={P.dot} />
      </ReactFlow>
    </div>
  );
}
