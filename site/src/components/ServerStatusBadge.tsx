import { Badge } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import type { ServerBootStatus } from "../types/server";

interface ServerStatusBadgeProps {
  status: ServerBootStatus;
  variant?: "soft";
}

/** Animated running/stopped badge for an frpc server. */
export function ServerStatusBadge({ status, variant }: ServerStatusBadgeProps) {
  const { t } = useTranslation();
  const running = status === "running";
  const stopped = status === "stopped";

  return (
    <Badge
      radius="full"
      variant={variant}
      color={running ? "green" : stopped ? "red" : "gray"}
      className={`animate-status-appear ${
        running ? "animate-status-pulse" : stopped ? "animate-status-fade" : ""
      }`}
    >
      <span
        className={`status-dot ${
          running ? "status-dot-green" : stopped ? "status-dot-red" : "status-dot-gray"
        }`}
      />
      {running ? t("server.running") : stopped ? t("server.stopped") : t("common.status")}
    </Badge>
  );
}
