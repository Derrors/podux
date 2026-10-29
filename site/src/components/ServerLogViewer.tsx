import { useEffect, useRef } from "react";
import { Badge, Box, Button, Flex, Heading, Text } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import { useLogStream, type LogStreamStatus } from "../hooks/useLogStream";

interface ServerLogViewerProps {
  serverId: string;
  /** Height of the scrollable log area. Defaults to 300px. */
  height?: number | string;
  /** Whether to show the card heading. Defaults to true. */
  showHeading?: boolean;
}

const statusColor: Record<LogStreamStatus, "green" | "amber" | "gray" | "red"> = {
  connected: "green",
  reconnecting: "amber",
  connecting: "gray",
  disconnected: "red",
};

function StreamStatus({ status, onReconnect }: { status: LogStreamStatus; onReconnect: () => void }) {
  const { t } = useTranslation();
  return (
    <Flex align="center" gap="2" role="status" aria-live="polite">
      <Badge color={statusColor[status]} variant="soft" radius="full">
        {status === "connecting" || status === "reconnecting" ? (
          <Icon icon="lucide:loader-2" width="10" height="10" className="animate-spin" />
        ) : (
          <span
            className={`status-dot ${status === "connected" ? "status-dot-green" : "status-dot-red"}`}
          />
        )}
        {t(`server.logStream.${status}`)}
      </Badge>
      {status === "disconnected" && (
        <Button size="1" variant="ghost" onClick={onReconnect}>
          {t("server.logStream.reconnect")}
        </Button>
      )}
    </Flex>
  );
}

function LogStreamPanel({ serverId, height = 300, showHeading = true }: ServerLogViewerProps) {
  const { t } = useTranslation();
  const { lines, status, clear, reconnect } = useLogStream(serverId);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  const clearButton = (
    <Button size="1" variant="soft" onClick={clear}>
      <Icon icon="lucide:trash-2" width="14" height="14" />
      {t("server.clear")}
    </Button>
  );

  return (
    <Flex direction="column" gap="3">
      <Flex justify="between" align="center" gap="2" wrap="wrap">
        <Flex align="center" gap="3">
          {showHeading && <Heading size="4">{t("server.connectionLogs")}</Heading>}
          <StreamStatus status={status} onReconnect={reconnect} />
        </Flex>
        {clearButton}
      </Flex>

      <Box
        ref={containerRef}
        style={{
          backgroundColor: "var(--gray-2)",
          borderRadius: "var(--radius-3)",
          padding: "1rem",
          fontFamily: "monospace",
          fontSize: "0.9rem",
          height,
          overflowY: "auto",
        }}
      >
        {lines.length > 0 ? (
          lines.map((line) => (
            <div key={line.id} style={{ marginBottom: "4px" }}>
              <Text color="gray">{line.text}</Text>
            </div>
          ))
        ) : (
          <Text color="gray" style={{ fontStyle: "italic" }}>
            {t("server.noLogsAvailable")}
          </Text>
        )}
      </Box>
    </Flex>
  );
}

/** Live frpc log tail for one server (SSE over fetch with auto-reconnect). */
export function ServerLogViewer(props: ServerLogViewerProps) {
  // Remount per server so lines and connection state never leak between servers.
  return <LogStreamPanel key={props.serverId} {...props} />;
}
