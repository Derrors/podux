import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Box, Button, Flex, Heading, Select, Text, TextField } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import { useLogStream, type LogStreamStatus } from "../hooks/useLogStream";
import { apiFetch } from "../lib/api";
import { notifyError } from "../lib/notify";
import { matchesLogFilter, type LogLevel } from "../lib/logFilter";

const LEVEL_OPTIONS: LogLevel[] = ["T", "D", "I", "W", "E"];

interface ServerLogViewerProps {
  /** A server ID, or "all" for the whole frpc log. */
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
  empty: "gray",
};

const statusDot: Partial<Record<LogStreamStatus, string>> = {
  connected: "status-dot-green",
  disconnected: "status-dot-red",
  empty: "status-dot-gray",
};

function StreamStatus({ status, onReconnect }: { status: LogStreamStatus; onReconnect: () => void }) {
  const { t } = useTranslation();
  return (
    <Flex align="center" gap="2" role="status" aria-live="polite">
      <Badge color={statusColor[status]} variant="soft" radius="full">
        {status === "connecting" || status === "reconnecting" ? (
          <Icon icon="lucide:loader-2" width="10" height="10" className="animate-spin" />
        ) : (
          <span className={`status-dot ${statusDot[status]}`} />
        )}
        {t(`server.logStream.${status}`)}
      </Badge>
      {(status === "disconnected" || status === "empty") && (
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
  const [minLevel, setMinLevel] = useState<LogLevel>("T");
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState(false);

  const visible = useMemo(
    () => lines.filter((l) => matchesLogFilter(l.text, minLevel, search.trim())),
    [lines, minLevel, search]
  );

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visible]);

  // Today's full log from the server, not just the lines kept in the viewer.
  const download = async () => {
    setDownloading(true);
    try {
      const res = await apiFetch(`/api/frpc/logs/download?id=${encodeURIComponent(serverId)}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `frpc-${serverId}-${new Date().toISOString().slice(0, 10)}.log`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notifyError(t("server.logDownloadFailed"), err);
    } finally {
      setDownloading(false);
    }
  };

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
        <Flex gap="2" align="center" wrap="wrap">
          <Select.Root value={minLevel} onValueChange={(v) => setMinLevel(v as LogLevel)}>
            <Select.Trigger variant="soft" aria-label={t("server.logLevelFilter")} />
            <Select.Content>
              {LEVEL_OPTIONS.map((l) => (
                <Select.Item key={l} value={l}>
                  {t(`server.logLevelAtLeast.${l}`)}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <TextField.Root
            size="1"
            placeholder={t("server.logSearch")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 180 }}
          >
            <TextField.Slot>
              <Icon icon="lucide:search" width="12" height="12" />
            </TextField.Slot>
          </TextField.Root>
          <Button size="1" variant="soft" disabled={downloading} onClick={download}>
            <Icon icon={downloading ? "lucide:loader-2" : "lucide:download"} className={downloading ? "animate-spin" : ""} width="14" height="14" />
            {t("server.logDownload")}
          </Button>
          {clearButton}
        </Flex>
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
        {visible.length > 0 ? (
          visible.map((line) => (
            <div key={line.id} style={{ marginBottom: "4px" }}>
              <Text color="gray">{line.text}</Text>
            </div>
          ))
        ) : (
          <Text color="gray" style={{ fontStyle: "italic" }}>
            {lines.length > 0 ? t("server.logNoMatch") : t("server.noLogsAvailable")}
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
