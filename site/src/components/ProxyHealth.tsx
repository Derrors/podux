import { useState } from "react";
import { Badge, Flex, Text, Tooltip } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import type { ProxyStatus } from "../hooks/useProxyStatus";
import { formatBytes, formatDuration } from "../lib/format";
import { msUntil } from "../pages/Proxies/ProxyFormPage/proxyOptions";
import { TrafficDialog } from "./TrafficDialog";

interface ProxyHealthProps {
  proxyId: string;
  proxyName: string;
  status?: ProxyStatus;
}

/**
 * Today's frps traffic (click for 7 days) and the latest external probe of a proxy.
 * Renders a dash when neither is available.
 */
export function ProxyHealth({ proxyId, proxyName, status }: ProxyHealthProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const traffic = status?.traffic;
  const probe = status?.probe;

  if (!traffic && !probe) {
    return (
      <Text size="2" color="gray">
        -
      </Text>
    );
  }

  return (
    <Flex direction="column" gap="1" align="start">
      {probe && (
        <Tooltip content={probe.reachable ? probe.endpoint : `${probe.endpoint}: ${probe.error ?? ""}`}>
          <Badge color={probe.reachable ? "green" : "red"} variant="soft" size="1">
            <Icon icon={probe.reachable ? "lucide:globe" : "lucide:globe-lock"} width="11" height="11" />
            {probe.reachable ? t("proxy.reachable") : t("proxy.unreachable")}
          </Badge>
        </Tooltip>
      )}
      {traffic && (
        <>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="cursor-pointer border-0 bg-transparent p-0 text-left"
            aria-label={t("traffic.title", { name: proxyName })}
          >
            <Text size="1" color="gray" className="whitespace-nowrap font-mono hover:underline">
              ↓{formatBytes(traffic.todayTrafficIn)} ↑{formatBytes(traffic.todayTrafficOut)}
              {traffic.curConns > 0 && ` · ${t("traffic.conns", { count: traffic.curConns })}`}
            </Text>
          </button>
          <TrafficDialog proxyId={proxyId} proxyName={proxyName} open={open} onOpenChange={setOpen} />
        </>
      )}
    </Flex>
  );
}

/** "Expires in 2h" badge for a temporary proxy; nothing when it doesn't expire. */
export function ExpiryBadge({ expiresAt }: { expiresAt?: string }) {
  const { t } = useTranslation();
  const left = msUntil(expiresAt);
  if (left === null) return null;
  return (
    <Tooltip content={new Date(expiresAt!.replace(" ", "T")).toLocaleString()}>
      <Badge color="amber" variant="soft" size="1">
        <Icon icon="lucide:timer" width="11" height="11" />
        {left > 0 ? t("proxy.expiresIn", { time: formatDuration(left) }) : t("proxy.expiring")}
      </Badge>
    </Tooltip>
  );
}
