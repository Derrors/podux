import { Icon } from "@iconify/react/offline";
import { Badge, Tooltip } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";

/** Configuration intent is not a tunnel health result; intentionally disabled proxies are neutral. */
export function ProxyRuntimeBadge({
  enabled,
  bootStatus,
}: {
  enabled: boolean;
  bootStatus: string;
}) {
  const { t } = useTranslation();
  const state = !enabled ? "disabled" : bootStatus === "online" ? "online" : "offline";
  return (
    <Tooltip content={t("proxy.tunnelStateHelp")}>
      <Badge
        color={state === "disabled" ? "gray" : state === "online" ? "green" : "red"}
        variant="soft"
      >
        <Icon
          icon={
            state === "disabled"
              ? "lucide:pause"
              : state === "online"
                ? "lucide:circle-check"
                : "lucide:circle-x"
          }
          width="12"
          height="12"
          aria-hidden="true"
        />
        {t(
          state === "disabled"
            ? "proxy.tunnelDisabled"
            : state === "online"
              ? "proxy.tunnelOnline"
              : "proxy.tunnelOffline"
        )}
      </Badge>
    </Tooltip>
  );
}
