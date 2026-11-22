import { Badge, Card, Flex, Table, Text } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import type { Proxy } from "../types/proxy";
import type { ProxyStatus } from "../hooks/useProxyStatus";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { formatEndpoint } from "../lib/endpoints";
import { CopyableText } from "./CopyableText";
import { ProxyEndpoints } from "./ProxyEndpoints";
import { ProxyRuntimeBadge } from "./ProxyRuntimeBadge";
import { ProxyStatusToggle } from "./ProxyStatusToggle";
import { ExpiryBadge, ProxyHealth } from "./ProxyHealth";
import { MoreActions } from "./MoreActions";

export function ServerProxyList({
  proxies,
  statuses,
  subdomainHost,
  togglingId,
  onToggle,
  onEdit,
  onDelete,
}: {
  proxies: Proxy[];
  statuses: Record<string, ProxyStatus>;
  subdomainHost?: string;
  togglingId: string | null;
  onToggle: (proxy: Proxy) => void;
  onEdit: (proxy: Proxy) => void;
  onDelete: (proxy: Proxy) => void;
}) {
  const { t } = useTranslation();
  const mobile = useMediaQuery("(max-width: 760px)");
  const identity = (proxy: Proxy) => (
    <Flex direction="column" gap="2" align="start">
      <Text size="2" weight="bold" style={{ overflowWrap: "anywhere" }}>
        {proxy.name || "—"}
      </Text>
      <Flex gap="2" wrap="wrap">
        <Badge color="gray" variant="surface" size="1">
          {proxy.proxyType.toUpperCase()}
        </Badge>
        <ExpiryBadge expiresAt={proxy.expiresAt} />
      </Flex>
    </Flex>
  );
  const mapping = (proxy: Proxy) => (
    <Flex direction="column" gap="2">
      <ProxyEndpoints proxy={proxy} subdomainHost={subdomainHost} />
      <Flex gap="2" align="start">
        <Icon
          icon="lucide:corner-down-right"
          width="13"
          height="13"
          style={{ color: "var(--gray-10)", marginTop: 4, flexShrink: 0 }}
        />
        {proxy.plugin?.type ? (
          <Text size="1" color="gray">
            {t("proxy.pluginTarget")}
          </Text>
        ) : (
          <CopyableText
            text={formatEndpoint(proxy.localIP || "127.0.0.1", proxy.localPort)}
            color="gray"
          />
        )}
      </Flex>
    </Flex>
  );
  const health = (proxy: Proxy) => (
    <ProxyHealth
      proxyId={proxy.id}
      proxyName={proxy.name ?? ""}
      status={statuses[proxy.id]}
      probeDisabled={proxy.probeDisabled}
    />
  );
  const toggle = (proxy: Proxy) => (
    <ProxyStatusToggle
      enabled={proxy.status === "enabled"}
      toggling={togglingId !== null}
      onToggle={() => onToggle(proxy)}
    />
  );
  const actions = (proxy: Proxy) => (
    <MoreActions
      name={proxy.name ?? proxy.id}
      disabled={togglingId !== null}
      actions={[
        { label: t("common.edit"), icon: "lucide:pencil", onSelect: () => onEdit(proxy) },
        {
          label: t("common.delete"),
          icon: "lucide:trash-2",
          danger: true,
          onSelect: () => onDelete(proxy),
        },
      ]}
    />
  );
  if (!proxies.length)
    return (
      <Flex align="center" justify="center" gap="2" py="6">
        <Icon icon="lucide:network" width="24" height="24" style={{ color: "var(--gray-10)" }} />
        <Text size="2" color="gray">
          {t("proxy.noProxies")}
        </Text>
      </Flex>
    );
  if (mobile)
    return (
      <div className="resource-cards">
        {proxies.map((proxy) => (
          <Card className="resource-card" size="2" key={proxy.id}>
            <div className="resource-card__header">
              {identity(proxy)}
              {actions(proxy)}
            </div>
            <div className="resource-card__fields">
              <div className="resource-card__field">
                <Text size="1" color="gray">
                  {t("proxy.mapping")}
                </Text>
                {mapping(proxy)}
              </div>
              <div className="resource-card__field">
                <Text size="1" color="gray">
                  {t("proxy.healthColumn")}
                </Text>
                {health(proxy)}
              </div>
            </div>
            <div className="resource-card__footer">
              <ProxyRuntimeBadge
                enabled={proxy.status === "enabled"}
                bootStatus={proxy.bootStatus}
              />
              {toggle(proxy)}
            </div>
          </Card>
        ))}
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <Table.Root className="resource-table">
        <Table.Header>
          <Table.Row>
            {[
              "common.name",
              "proxy.mapping",
              "proxy.tunnelState",
              "proxy.healthColumn",
              "proxy.configurationState",
              "common.actions",
            ].map((key) => (
              <Table.ColumnHeaderCell key={key}>{t(key)}</Table.ColumnHeaderCell>
            ))}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {proxies.map((proxy) => (
            <Table.Row key={proxy.id}>
              <Table.Cell>{identity(proxy)}</Table.Cell>
              <Table.Cell>{mapping(proxy)}</Table.Cell>
              <Table.Cell>
                <ProxyRuntimeBadge
                  enabled={proxy.status === "enabled"}
                  bootStatus={proxy.bootStatus}
                />
              </Table.Cell>
              <Table.Cell>{health(proxy)}</Table.Cell>
              <Table.Cell>{toggle(proxy)}</Table.Cell>
              <Table.Cell>{actions(proxy)}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </div>
  );
}
