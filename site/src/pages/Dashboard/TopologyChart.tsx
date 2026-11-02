import { memo, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button, Dialog, Flex, IconButton, Text, Tooltip, useThemeContext } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import type { TopologyData } from "./useDashboard";
import { groupTopology } from "./topologyData";

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
} as const;

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
        <span style={{ color: P.text, fontWeight: 700 }}>{data.proxyType.toUpperCase()}</span>
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
        {data.localPort
          ? `${data.localIP}:${data.localPort}`
          : t("dashboard.topologyHandledByPlugin")}
      </span>
    </NodeCard>
  );
}

// ── frp Visitor Node (stcp/sudp/xtcp visitor running on this machine) ─────────
function FrpVisitorNode({ data }: { data: Record<string, string> }) {
  const { t } = useTranslation();
  const enabled = data.status === "enabled";
  return (
    <NodeCard
      w={PROXY_W}
      h={PROXY_H}
      accentColor={enabled ? C.eOn : C.eOff}
      targetPos={Position.Left}
      targetColor={enabled ? C.eOn : C.eOff}
      sourcePos={Position.Right}
      sourceColor={enabled ? C.eOn : C.eOff}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon icon="lucide:door-open" width={13} height={13} color={P.sub} />
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
      <span
        style={{
          fontSize: 10,
          color: P.sub,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ fontWeight: 700 }}>{data.visitorType.toUpperCase()}</span> →{" "}
        {data.serverName}
      </span>
      <StatusPill online={enabled} labels={[t("proxy.enabled"), t("proxy.disabled")]} />
    </NodeCard>
  );
}

// ── Local listener of a visitor ───────────────────────────────────────────────
function LocalListenerNode({ data }: { data: Record<string, string> }) {
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
        <Icon icon="lucide:monitor" width={13} height={13} color={P.sub} />
        <span style={{ fontSize: 10, fontWeight: 700, color: P.text }}>
          {t("dashboard.topologyLocalListener")}
        </span>
      </div>
      <span style={{ fontSize: 11, color: P.sub, fontFamily: "monospace" }}>{data.listen}</span>
    </NodeCard>
  );
}

const nodeTypes = {
  frpVisitor: FrpVisitorNode,
  localListener: LocalListenerNode,
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

function TopologyTable({ topology }: TopologyChartProps) {
  const { t } = useTranslation();
  return (
    <div
      style={{ overflowX: "auto" }}
      tabIndex={0}
      role="region"
      aria-label={t("dashboard.topologyTable")}
    >
      {groupTopology(topology).map(({ server, proxies, visitors }) => (
        <table
          key={server.id}
          style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontSize: 13 }}
        >
          <caption style={{ textAlign: "left", padding: "8px 0", overflowWrap: "anywhere" }}>
            {server.serverName} · {server.serverAddr} ·{" "}
            {t(server.bootStatus === "running" ? "server.running" : "server.stopped")}
          </caption>
          <thead>
            <tr>
              {[
                "common.name",
                "common.type",
                "dashboard.topologyLocalService",
                "common.status",
              ].map((key) => (
                <th key={key} scope="col" style={{ textAlign: "left", padding: 8 }}>
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {proxies.map((proxy) => (
              <tr key={`proxy-${proxy.id}`}>
                <th scope="row" style={{ padding: 8, textAlign: "left", overflowWrap: "anywhere" }}>
                  {proxy.name}
                </th>
                <td style={{ padding: 8 }}>
                  {proxy.proxyType.toUpperCase()}
                  {proxy.remotePort ? ` :${proxy.remotePort}` : ""}
                </td>
                <td style={{ padding: 8, overflowWrap: "anywhere" }}>
                  {proxy.localPort
                    ? `${proxy.localIP}:${proxy.localPort}`
                    : t("dashboard.topologyHandledByPlugin")}
                </td>
                <td style={{ padding: 8 }}>
                  {t(proxy.bootStatus === "online" ? "proxy.online" : "proxy.offline")}
                </td>
              </tr>
            ))}
            {visitors.map((visitor) => (
              <tr key={`frpVisitor-${visitor.id}`}>
                <th scope="row" style={{ padding: 8, textAlign: "left", overflowWrap: "anywhere" }}>
                  {visitor.name}
                </th>
                <td style={{ padding: 8 }}>
                  {visitor.visitorType.toUpperCase()} → {visitor.serverName}
                </td>
                <td style={{ padding: 8, overflowWrap: "anywhere" }}>
                  {visitor.bindPort > 0
                    ? `${visitor.bindAddr || "127.0.0.1"}:${visitor.bindPort}`
                    : t("dashboard.topologyFallbackOnly")}
                </td>
                <td style={{ padding: 8 }}>
                  {t(visitor.status === "enabled" ? "proxy.enabled" : "proxy.disabled")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

export const TopologyChart = memo(function TopologyChart({ topology }: TopologyChartProps) {
  const { t } = useTranslation();
  const themeCtx = useThemeContext();
  const isDark = themeCtx.appearance === "dark";
  const [fullscreen, setFullscreen] = useState(false);
  const [table, setTable] = useState(false);
  const { servers, proxies, visitors } = topology;

  const { nodes, edges, totalRows } = useMemo(() => {
    if (servers.length === 0) return { nodes: [], edges: [], totalRows: 0 };

    // build row assignments
    const serverRows: Array<{
      server: (typeof servers)[0];
      sProxies: typeof proxies;
      sVisitors: typeof visitors;
      startRow: number;
      rowCount: number;
    }> = [];
    let row = 0;
    for (const { server, proxies: sProxies, visitors: sVisitors } of groupTopology({
      servers,
      proxies,
      visitors,
    })) {
      const rowCount = Math.max(sProxies.length + sVisitors.length, 1);
      serverRows.push({ server, sProxies, sVisitors, startRow: row, rowCount });
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

    for (const { server, sProxies, sVisitors, startRow, rowCount } of serverRows) {
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

      sVisitors.forEach((v, vi) => {
        const enabled = v.status === "enabled";
        const rowCY = (startRow + sProxies.length + vi) * ROW_H + ROW_H / 2;
        const listenId = `listen-${v.id}`;
        nodes.push({
          id: v.id,
          type: "frpVisitor",
          position: { x: COL.proxy, y: rowCY - PROXY_H / 2 },
          data: {
            name: v.name,
            visitorType: v.visitorType,
            serverName: v.serverName,
            status: v.status,
          },
          draggable: false,
        });
        nodes.push({
          id: listenId,
          type: "localListener",
          position: { x: COL.local, y: rowCY - LOCAL_H / 2 },
          data: {
            listen:
              v.bindPort > 0
                ? `${v.bindAddr || "127.0.0.1"}:${v.bindPort}`
                : t("dashboard.topologyFallbackOnly"),
          },
          draggable: false,
        });
        edges.push(
          mkEdge(`e-${server.id}-${v.id}`, server.id, v.id, C.eOn, serverOnline && enabled)
        );
        edges.push(mkEdge(`e-${v.id}-${listenId}`, v.id, listenId, C.eOn, serverOnline && enabled));
      });

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
            remotePort: px.remotePort ? String(px.remotePort) : "",
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
            localPort: String(px.localPort || ""),
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
  }, [servers, proxies, visitors, t]);

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
    <>
      {/* Complete overview, as before: no server filtering, collapsed branches or paging. */}
      {/* Read-only on the dashboard: wheel and touch scroll the page instead of zooming the chart. */}
      <div
        style={{ position: "relative", height: containerH, borderRadius: 8, overflow: "hidden" }}
      >
        {!fullscreen && (
          <TopologyFlow nodes={nodes} edges={edges} isDark={isDark} interactive={false} />
        )}
        <Tooltip content={t("dashboard.topologyFullscreen")}>
          <IconButton
            variant="surface"
            color="gray"
            aria-label={t("dashboard.topologyFullscreen")}
            onClick={() => setFullscreen(true)}
            style={{ position: "absolute", top: 12, right: 12 }}
          >
            <Icon icon="lucide:maximize-2" width="16" height="16" />
          </IconButton>
        </Tooltip>
      </div>

      <Dialog.Root
        open={fullscreen}
        onOpenChange={(open) => {
          setFullscreen(open);
          if (!open) setTable(false);
        }}
      >
        <Dialog.Content
          width="100%"
          minWidth="0"
          maxWidth="min(1600px, calc(100vw - 32px))"
          height="92vh"
          maxHeight="92vh"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
        >
          <Flex justify="between" align="start" gap="3">
            <Flex direction="column" gap="1">
              <Dialog.Title size="4" mb="0">
                {t("dashboard.topology")}
              </Dialog.Title>
              <Dialog.Description size="2" color="gray">
                {t("dashboard.topologyFullscreenHint")}
              </Dialog.Description>
            </Flex>
            <Dialog.Close>
              <IconButton variant="ghost" color="gray" aria-label={t("common.close")}>
                <Icon icon="lucide:x" width="18" height="18" />
              </IconButton>
            </Dialog.Close>
          </Flex>
          <Flex gap="3" align="center" wrap="wrap">
            <Button
              variant="soft"
              size="1"
              onClick={() => setTable((value) => !value)}
              aria-pressed={table}
            >
              {t(table ? "dashboard.topologyGraph" : "dashboard.topologyTable")}
            </Button>
            <Text size="1" color="gray">
              {t("dashboard.topologyLegend")}
            </Text>
          </Flex>
          <div
            style={{ flex: 1, minHeight: 0, borderRadius: 8, overflow: table ? "auto" : "hidden" }}
          >
            {fullscreen &&
              (table ? (
                <TopologyTable topology={topology} />
              ) : (
                <TopologyFlow nodes={nodes} edges={edges} isDark={isDark} interactive />
              ))}
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
});

interface TopologyFlowProps {
  nodes: Node[];
  edges: Edge[];
  isDark: boolean;
  /** Pan, zoom and zoom controls; off for the inline dashboard chart. */
  interactive: boolean;
}

function TopologyFlow({ nodes, edges, isDark, interactive }: TopologyFlowProps) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const visibleEdges = useMemo(
    () =>
      edges.map((edge) => ({ ...edge, animated: interactive && !reducedMotion && edge.animated })),
    [edges, interactive, reducedMotion]
  );
  return (
    <ReactFlow
      nodes={nodes}
      edges={visibleEdges}
      nodeTypes={nodeTypes}
      onlyRenderVisibleElements
      nodesFocusable={false}
      edgesFocusable={false}
      ariaLabelConfig={{
        "controls.zoomIn.ariaLabel": t("dashboard.topologyZoomIn"),
        "controls.zoomOut.ariaLabel": t("dashboard.topologyZoomOut"),
        "controls.fitView.ariaLabel": t("dashboard.topologyFitView"),
      }}
      colorMode={isDark ? "dark" : "light"}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag={interactive}
      zoomOnScroll={interactive}
      zoomOnPinch={interactive}
      zoomOnDoubleClick={interactive}
      preventScrolling={interactive}
      minZoom={0.25}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      style={{ background: P.pageBg }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={P.dot} />
      {interactive && <Controls showInteractive={false} />}
    </ReactFlow>
  );
}
