import { Badge } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import type { ServerBootStatus } from "../types/server";

interface ServerStatusBadgeProps {
  status: ServerBootStatus;
  variant?: "soft";
}

/** A stopped frpc is not necessarily a failure; show it neutrally unless an error is known. */
export function ServerStatusBadge({ status, variant = "soft" }: ServerStatusBadgeProps) {
  const { t } = useTranslation();
  const running = status === "running";
  const stopped = status === "stopped";
  return (
    <Badge radius="full" variant={variant} color={running ? "green" : "gray"}>
      <Icon
        icon={running ? "lucide:circle-check" : stopped ? "lucide:square" : "lucide:circle-help"}
        width="12"
        height="12"
        aria-hidden="true"
      />
      {t(running ? "server.running" : stopped ? "server.stopped" : "server.unknownState")}
    </Badge>
  );
}
