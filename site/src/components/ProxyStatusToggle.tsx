import { Badge } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";

interface ProxyStatusToggleProps {
  enabled: boolean;
  toggling: boolean;
  onToggle: () => void;
}

/** Enabled/disabled badge that toggles the proxy status on click. */
export function ProxyStatusToggle({ enabled, toggling, onToggle }: ProxyStatusToggleProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={toggling}
      style={{
        cursor: toggling ? "not-allowed" : "pointer",
        background: "none",
        border: "none",
        padding: 0,
        opacity: toggling ? 0.6 : 1,
        transition: "opacity 0.2s",
      }}
      title={enabled ? t("proxy.clickToDisable") : t("proxy.clickToEnable")}
    >
      <Badge color={enabled ? "green" : "gray"} style={{ cursor: "inherit" }}>
        {toggling ? (
          <Icon icon="lucide:loader-2" width="12" height="12" className="animate-spin" />
        ) : (
          <Icon icon={enabled ? "lucide:power" : "lucide:power-off"} width="12" height="12" />
        )}
        {enabled ? t("proxy.enabled") : t("proxy.disabled")}
      </Badge>
    </button>
  );
}
