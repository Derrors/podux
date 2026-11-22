import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  ControlButton,
  getViewportForBounds,
  Handle,
  Position,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Dialog,
  Flex,
  Heading,
  IconButton,
  Text,
  Tooltip,
  useThemeContext,
} from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import type { TopologyData } from "./useDashboard";
import { groupTopology } from "./topologyData";
import { topologyPath } from "./topologyFocus";
import { minimumOverviewZoom, topologyBounds } from "./topologyViewport";
import { formatEndpoint } from "../../lib/endpoints";

// ── Layout ────────────────────────────────────────────────────────────────────
const VISITOR_W = 128;
const VISITOR_H = 100;
const SERVER_W = 188;
const SERVER_H = 108;
const PROXY_W = 184;
const PROXY_H = 108;
const LOCAL_W = 180;
const LOCAL_H = 84;
const ROW_H = 132;
const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  visitor: { width: VISITOR_W, height: VISITOR_H },
  server: { width: SERVER_W, height: SERVER_H },
  proxy: { width: PROXY_W, height: PROXY_H },
  frpVisitor: { width: PROXY_W, height: PROXY_H },
  localService: { width: LOCAL_W, height: LOCAL_H },
  localListener: { width: LOCAL_W, height: LOCAL_H },
};

// Four stable columns keep the full multi-server overview visible.
const COL = {
  visitor: 0,
  server: 182,
  proxy: 452,
  local: 716,
};

// ── Colours ───────────────────────────────────────────────────────────────────
// Radix CSS variables resolve per theme (light/dark), so nodes, edges and the
// canvas follow the app appearance without a separate palette.
const C = {
  eVisitor: "var(--blue-8)",
  eOn: "var(--green-8)",
  eOff: "var(--gray-7)",
  hBlue: "var(--blue-9)",
  hGreen: "var(--green-9)",
  hOff: "var(--gray-8)",
} as const;

const P = {
  bg: "var(--color-panel-solid)",
  text: "var(--gray-12)",
  sub: "var(--gray-11)",
  border: "var(--gray-5)",
  pageBg: "var(--gray-1)",
  dot: "var(--gray-5)",
};

// Shared
function StatusPill({
  online,
  labels,
  neutral = false,
}: {
  online: boolean;
  labels: [string, string];
  neutral?: boolean;
}) {
  const scale = online ? "green" : neutral ? "gray" : "red";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        alignSelf: "flex-start",
        maxWidth: "100%",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        background: `var(--${scale}-a3)`,
        color: `var(--${scale}-11)`,
      }}
    >
      <Icon
        icon={online ? "lucide:circle-check" : neutral ? "lucide:pause" : "lucide:circle-x"}
        width="11"
        height="11"
      />
      {online ? labels[0] : labels[1]}
    </span>
  );
}

function NodeIcon({
  icon,
  background,
  color,
}: {
  icon: string;
  background: string;
  color: string;
}) {
  return (
    <span
      style={{
        width: 24,
        height: 24,
        borderRadius: 7,
        background,
        color,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Icon icon={icon} width={13} height={13} />
    </span>
  );
}

function NodeCard({
  w,
  h,
  borderColor = P.border,
  background = P.bg,
  shadow = "0 2px 8px var(--gray-a3)",
  children,
  targetPos,
  targetColor,
  sourcePos,
  sourceColor,
}: {
  w: number;
  h: number;
  borderColor?: string;
  background?: string;
  shadow?: string;
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
        borderRadius: 14,
        boxSizing: "border-box",
        border: `1.5px solid ${borderColor}`,
        background,
        display: "flex",
        flexDirection: "column",
        padding: "11px 12px",
        gap: 6,
        boxShadow: shadow,
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
        borderRadius: 14,
        boxSizing: "border-box",
        border: "1.5px solid var(--blue-a6)",
        background: P.bg,
        boxShadow: "0 2px 10px var(--blue-a3)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
    >
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: C.hBlue, border: "none", width: 8, height: 8 }}
      />
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "var(--blue-9)",
          color: "var(--blue-contrast)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon icon="lucide:users" width={18} height={18} />
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
  return (
    <NodeCard
      w={SERVER_W}
      h={SERVER_H}
      borderColor={online ? "var(--blue-a6)" : P.border}
      shadow={online ? "0 2px 10px var(--blue-a3)" : "0 2px 8px var(--gray-a3)"}
      targetPos={Position.Left}
      targetColor={online ? C.hBlue : C.hOff}
      sourcePos={Position.Right}
      sourceColor={online ? C.hGreen : C.hOff}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <NodeIcon
          icon="lucide:server"
          background={online ? "var(--blue-9)" : "var(--gray-a3)"}
          color={online ? "var(--blue-contrast)" : "var(--gray-11)"}
        />
        <span
          style={{
            fontSize: 13,
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
          fontSize: 11,
          color: P.sub,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {data.serverAddr}
      </span>
      <StatusPill online={online} neutral labels={[t("server.running"), t("server.stopped")]} />
    </NodeCard>
  );
}

// Proxy Node
function ProxyNode({ data }: { data: Record<string, string> }) {
  const { t } = useTranslation();
  const enabled = data.status === "enabled";
  const online = enabled && data.bootStatus === "online";
  const handleColor = online ? C.hGreen : C.hOff;
  return (
    <NodeCard
      w={PROXY_W}
      h={PROXY_H}
      borderColor={online ? "var(--green-a6)" : enabled ? "var(--red-a6)" : P.border}
      background={
        online ? "color-mix(in srgb, var(--color-panel-solid) 92%, var(--green-a3))" : P.bg
      }
      shadow={online ? "0 2px 10px var(--green-a3)" : "0 2px 8px var(--gray-a3)"}
      targetPos={Position.Left}
      targetColor={handleColor}
      sourcePos={Position.Right}
      sourceColor={handleColor}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <NodeIcon
          icon="lucide:network"
          background={online ? "var(--green-9)" : enabled ? "var(--red-a3)" : "var(--gray-a3)"}
          color={online ? "var(--green-contrast)" : enabled ? "var(--red-10)" : "var(--gray-11)"}
        />
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: P.text,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {data.name}
        </span>
      </div>
      <span style={{ fontSize: 10, color: P.sub }}>
        <span style={{ color: P.text, fontWeight: 700 }}>{data.proxyType.toUpperCase()}</span>
        {data.remotePort && <span style={{ fontFamily: "monospace" }}> :{data.remotePort}</span>}
      </span>
      <StatusPill
        online={online}
        neutral={!enabled}
        labels={[
          t("proxy.tunnelOnline"),
          t(enabled ? "proxy.tunnelOffline" : "proxy.tunnelDisabled"),
        ]}
      />
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
      borderColor={P.border}
      targetPos={Position.Left}
      targetColor={C.hOff}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <NodeIcon icon="lucide:hard-drive" background="var(--purple-a3)" color="var(--purple-10)" />
        <span style={{ fontSize: 11, fontWeight: 700, color: P.text }}>
          {t("dashboard.topologyLocalService")}
        </span>
      </div>
      <span style={{ fontSize: 11, color: P.sub, fontFamily: "monospace" }}>
        {data.localPort
          ? formatEndpoint(data.localIP, data.localPort)
          : t("dashboard.topologyHandledByPlugin")}
      </span>
    </NodeCard>
  );
}

// ── frp Visitor Node (stcp/sudp/xtcp visitor running on this machine) ─────────
function FrpVisitorNode({ data }: { data: Record<string, string> }) {
  const { t } = useTranslation();
  const enabled = data.status === "enabled";
  const handleColor = enabled ? C.hGreen : C.hOff;
  return (
    <NodeCard
      w={PROXY_W}
      h={PROXY_H}
      borderColor={enabled ? "var(--green-a6)" : P.border}
      background={
        enabled ? "color-mix(in srgb, var(--color-panel-solid) 92%, var(--green-a3))" : P.bg
      }
      shadow={enabled ? "0 2px 10px var(--green-a3)" : "0 2px 8px var(--gray-a3)"}
      targetPos={Position.Left}
      targetColor={handleColor}
      sourcePos={Position.Right}
      sourceColor={handleColor}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <NodeIcon
          icon="lucide:door-open"
          background={enabled ? "var(--green-9)" : "var(--gray-a3)"}
          color={enabled ? "var(--green-contrast)" : "var(--gray-11)"}
        />
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: P.text,
            flex: 1,
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
          fontSize: 11,
          color: P.sub,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ fontWeight: 700 }}>{data.visitorType.toUpperCase()}</span> →{" "}
        {data.serverName}
      </span>
      <StatusPill online={enabled} neutral labels={[t("proxy.enabled"), t("proxy.disabled")]} />
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
      borderColor={P.border}
      targetPos={Position.Left}
      targetColor={C.hOff}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <NodeIcon icon="lucide:monitor" background="var(--cyan-a3)" color="var(--cyan-10)" />
        <span style={{ fontSize: 11, fontWeight: 700, color: P.text }}>
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

export const TopologyChart = memo(function TopologyChart({ topology }: TopologyChartProps) {
  const { t } = useTranslation();
  const themeCtx = useThemeContext();
  const isDark = themeCtx.appearance === "dark";
  const [fullscreen, setFullscreen] = useState(false);
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
      edges.push(mkEdge(`e-vis-${server.id}`, "visitor", server.id, C.eVisitor, serverOnline));

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
                ? formatEndpoint(v.bindAddr || "127.0.0.1", v.bindPort)
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
        const proxyOnline = px.status === "enabled" && px.bootStatus === "online";
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
            serverId: server.id,
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
        edges.push(
          mkEdge(`e-${px.id}-${localId}`, px.id, localId, C.eOn, serverOnline && proxyOnline)
        );
      });
    }

    // Explicit dimensions let the initial fit include all nodes, even before visible-only rendering measures them.
    for (const node of nodes) Object.assign(node, NODE_DIMENSIONS[node.type ?? ""]);
    return { nodes, edges, totalRows };
  }, [servers, proxies, visitors, t]);

  if (servers.length === 0) {
    return (
      <Flex direction="column" gap="3">
        <Heading size="3">{t("dashboard.topology")}</Heading>
        <Flex direction="column" align="center" justify="center" gap="3" style={{ height: 240 }}>
          <Icon icon="lucide:network" color="var(--gray-7)" width="48" height="48" />
          <Flex direction="column" align="center" gap="1">
            <Text size="3" weight="medium" color="gray">
              {t("dashboard.topologyEmpty")}
            </Text>
            <Text size="2" color="gray">
              {t("dashboard.topologyEmptyDesc")}
            </Text>
          </Flex>
        </Flex>
      </Flex>
    );
  }

  const containerH = Math.max(480, Math.min(900, totalRows * ROW_H + 80));

  return (
    <Flex direction="column" gap="3">
      <Flex justify="between" align="center" gap="3" wrap="wrap">
        <Heading size="3">{t("dashboard.topology")}</Heading>
        <Tooltip content={t("dashboard.topologyFullscreen")}>
          <IconButton
            variant="soft"
            color="gray"
            aria-label={t("dashboard.topologyFullscreen")}
            onClick={() => setFullscreen(true)}
          >
            <Icon icon="lucide:maximize-2" width="16" height="16" aria-hidden="true" />
          </IconButton>
        </Tooltip>
      </Flex>
      {/* Read-only inline: the page keeps its wheel/touch scroll and every branch. */}
      <div
        style={{
          position: "relative",
          height: containerH,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid var(--gray-4)",
        }}
      >
        {!fullscreen && (
          <TopologyFlow nodes={nodes} edges={edges} isDark={isDark} interactive={false} />
        )}
      </div>

      <Dialog.Root open={fullscreen} onOpenChange={setFullscreen}>
        <Dialog.Content
          aria-describedby={undefined}
          width="100%"
          minWidth="0"
          maxWidth="min(1600px, calc(100vw - 32px))"
          height="92vh"
          maxHeight="92vh"
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
        >
          <Flex justify="between" align="center" gap="3">
            <Dialog.Title size="4" mb="0">
              {t("dashboard.topology")}
            </Dialog.Title>
            <Dialog.Close>
              <IconButton variant="ghost" color="gray" aria-label={t("common.close")}>
                <Icon icon="lucide:x" width="18" height="18" />
              </IconButton>
            </Dialog.Close>
          </Flex>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid var(--gray-4)",
            }}
          >
            {fullscreen && <TopologyFlow nodes={nodes} edges={edges} isDark={isDark} interactive />}
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
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
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [paneSize, setPaneSize] = useState({ width: 0, height: 0 });
  const bounds = useMemo(() => topologyBounds(nodes), [nodes]);
  const minZoom = minimumOverviewZoom(bounds, paneSize.width, paneSize.height);
  const initializedOverview = useRef(false);
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const measure = () => {
      const { width, height } = pane.getBoundingClientRect();
      setPaneSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height }
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!instance || !paneSize.width || !paneSize.height) return;
    // Fullscreen fits once, then preserves the user's viewport across polling.
    if (interactive && initializedOverview.current) return;
    initializedOverview.current = true;
    // fitView needs DOM measurements, which off-screen virtualized nodes do not have.
    void instance.setViewport(
      getViewportForBounds(bounds, paneSize.width, paneSize.height, minZoom, 2, 0.2),
      { duration: 0 }
    );
  }, [instance, interactive, minZoom, paneSize.width, paneSize.height, bounds]);
  const path = useMemo(() => topologyPath(nodes, edges, selectedId), [nodes, edges, selectedId]);
  const focusedNodes = useMemo(
    () =>
      path.nodeIds.size === 0
        ? nodes
        : nodes.map((node) => ({
            ...node,
            style: {
              ...node.style,
              opacity: path.nodeIds.has(node.id) ? 1 : 0.35,
              outline: node.id === selectedId ? "2px solid var(--accent-9)" : undefined,
              outlineOffset: 4,
              borderRadius: 14,
            },
          })),
    [nodes, path, selectedId]
  );
  const visibleEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        animated: interactive && !reducedMotion && edge.animated,
        style: {
          ...edge.style,
          opacity: path.edgeIds.size === 0 || path.edgeIds.has(edge.id) ? 1 : 0.22,
          strokeWidth: path.edgeIds.has(edge.id) ? 3 : edge.style?.strokeWidth,
        },
      })),
    [edges, interactive, reducedMotion, path]
  );

  const fitOverview = () => {
    if (!instance || !paneSize.width || !paneSize.height) return;
    setSelectedId(null);
    void instance.setViewport(
      getViewportForBounds(bounds, paneSize.width, paneSize.height, minZoom, 2, 0.2),
      { duration: reducedMotion ? 0 : 250 }
    );
  };
  const toggleNodeFocus = (id: string) => {
    setSelectedId((current) => (current === id ? null : id));
  };

  return (
    <div ref={paneRef} style={{ width: "100%", height: "100%", minHeight: 0 }}>
      <ReactFlow
        nodes={focusedNodes}
        edges={visibleEdges}
        nodeTypes={nodeTypes}
        onInit={setInstance}
        onNodeClick={interactive ? (_event, node) => toggleNodeFocus(node.id) : undefined}
        onPaneClick={interactive ? () => setSelectedId(null) : undefined}
        onlyRenderVisibleElements
        nodesFocusable={false}
        edgesFocusable={false}
        ariaLabelConfig={{
          "controls.zoomIn.ariaLabel": t("dashboard.topologyZoomIn"),
          "controls.zoomOut.ariaLabel": t("dashboard.topologyZoomOut"),
          "controls.fitView.ariaLabel": t("dashboard.topologyFitView"),
        }}
        colorMode={isDark ? "dark" : "light"}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={interactive}
        zoomOnScroll={interactive}
        zoomOnPinch={interactive}
        zoomOnDoubleClick={interactive}
        preventScrolling={interactive}
        minZoom={minZoom}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        style={{ background: P.pageBg }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color={P.dot} />
        {interactive && (
          <Controls showInteractive={false} showFitView={false}>
            <ControlButton
              onClick={fitOverview}
              title={t("dashboard.topologyFitView")}
              aria-label={t("dashboard.topologyFitView")}
            >
              <Icon icon="lucide:scan" width="14" height="14" />
            </ControlButton>
          </Controls>
        )}
      </ReactFlow>
    </div>
  );
}
