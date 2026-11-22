import { Icon } from "@iconify/react/offline";
import { Badge, Button, Card, Checkbox, Flex, Select, Table, Text } from "@radix-ui/themes";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { StatCard } from "../../components/StatCard";
import { Loading } from "../../components/Loading";
import { PaginationBar } from "../../components/PaginationBar";
import { SearchField } from "../../components/SearchField";
import { RefreshButton } from "../../components/RefreshButton";
import { ConfirmDeleteDialog } from "../../components/ConfirmDeleteDialog";
import { CopyableText } from "../../components/CopyableText";
import { ProxyEndpoints } from "../../components/ProxyEndpoints";
import { ProxyStatusToggle } from "../../components/ProxyStatusToggle";
import { ProxyRuntimeBadge } from "../../components/ProxyRuntimeBadge";
import { ExpiryBadge, ProxyHealth } from "../../components/ProxyHealth";
import { MoreActions } from "../../components/MoreActions";
import { ResourceListToolbar } from "../../components/ResourceListToolbar";
import { Reveal } from "../../components/Reveal";
import { useDelayedMount } from "../../hooks/useDelayedMount";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { formatEndpoint } from "../../lib/endpoints";
import type { ProxyStatus } from "../../hooks/useProxyStatus";
import type { ServerOption } from "./ProxyFormPage/useProxyForm";
import type { Proxy } from "../../types/proxy";

interface ProxiesViewProps {
  proxies: Proxy[];
  loading: boolean;
  refreshing: boolean;
  stats: { total: number; online: number; offline: number };
  deleteProxy: (id: string) => Promise<void>;
  toggleStatus: (proxy: Proxy) => Promise<void>;
  statuses: Record<string, ProxyStatus>;
  subdomainHosts: Record<string, string>;
  servers: ServerOption[];
  selected: Set<string>;
  toggleSelected: (id: string) => void;
  selectPage: (all: boolean) => void;
  runBatch: (action: "enable" | "disable" | "delete" | "move", serverId?: string) => Promise<void>;
  batchBusy: boolean;
  refreshProxies: () => void;
  page: number;
  setPage: (page: number) => void;
  totalPages: number;
  totalItems: number;
  search: string;
  setSearch: (value: string) => void;
  filters: { serverId: string; type: string; state: string };
  setFilter: (key: "serverId" | "type" | "state", value: string) => void;
  resetFilters: () => void;
  hasFilters: boolean;
}

const protocolTypes = ["tcp", "udp", "http", "https", "tcpmux", "stcp", "sudp", "xtcp"];

export function ProxiesView({
  proxies,
  loading,
  refreshing,
  stats,
  deleteProxy,
  toggleStatus,
  statuses,
  subdomainHosts,
  servers,
  selected,
  toggleSelected,
  selectPage,
  runBatch,
  batchBusy,
  refreshProxies,
  page,
  setPage,
  totalPages,
  totalItems,
  search,
  setSearch,
  filters,
  setFilter,
  resetFilters,
  hasFilters,
}: ProxiesViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mounted = useDelayedMount();
  const mobile = useMediaQuery("(max-width: 760px)");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const pending = useRef(new Set<string>());
  const allSelected = proxies.length > 0 && proxies.every((proxy) => selected.has(proxy.id));
  const handleToggle = async (proxy: Proxy) => {
    if (batchBusy || pending.current.has(proxy.id)) return;
    pending.current.add(proxy.id);
    setTogglingIds(new Set(pending.current));
    try {
      await toggleStatus(proxy);
    } finally {
      pending.current.delete(proxy.id);
      setTogglingIds(new Set(pending.current));
    }
  };
  const actions = (proxy: Proxy) => (
    <MoreActions
      name={proxy.name ?? proxy.id}
      disabled={batchBusy || togglingIds.has(proxy.id)}
      actions={[
        {
          label: t("common.edit"),
          icon: "lucide:pencil",
          onSelect: () => navigate(`/proxies/${proxy.id}/edit`),
        },
        {
          label: t("proxy.clone"),
          icon: "lucide:copy",
          onSelect: () => navigate(`/proxies/new?from=${proxy.id}`),
        },
        {
          label: t("common.delete"),
          icon: "lucide:trash-2",
          danger: true,
          onSelect: () => setDeleteId(proxy.id),
        },
      ]}
    />
  );
  const serverLink = (proxy: Proxy) =>
    proxy.expand?.serverId ? (
      <Link
        to={`/servers/${proxy.serverId}`}
        style={{
          textDecoration: "none",
          color: "var(--accent-11)",
          fontSize: 13,
          display: "inline-block",
          minWidth: 88,
          maxWidth: "100%",
          overflowWrap: "anywhere",
        }}
      >
        {proxy.expand.serverId.serverName}
      </Link>
    ) : (
      <Text size="2" color="gray">
        —
      </Text>
    );
  const identity = (proxy: Proxy) => (
    <div className="resource-name">
      <span className="resource-name__icon" aria-hidden="true">
        <Icon icon="lucide:network" width="17" height="17" />
      </span>
      <div className="min-w-0">
        <Text as="div" size="2" weight="bold" style={{ overflowWrap: "anywhere" }}>
          {proxy.name || "—"}
        </Text>
        <Flex gap="2" mt="1" align="center" wrap="wrap">
          <Badge variant="surface" color="gray" size="1">
            {proxy.proxyType.toUpperCase()}
          </Badge>
          <ExpiryBadge expiresAt={proxy.expiresAt} />
        </Flex>
      </div>
    </div>
  );
  const mapping = (proxy: Proxy) => (
    <Flex direction="column" gap="2" className="min-w-0">
      <ProxyEndpoints proxy={proxy} subdomainHost={subdomainHosts[proxy.serverId]} />
      <Flex align="start" gap="2">
        <Icon
          icon="lucide:corner-down-right"
          width="13"
          height="13"
          style={{ color: "var(--gray-10)", flexShrink: 0, marginTop: 4 }}
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
  const configuration = (proxy: Proxy) => (
    <ProxyStatusToggle
      enabled={proxy.status === "enabled"}
      toggling={batchBusy || togglingIds.has(proxy.id)}
      onToggle={() => void handleToggle(proxy)}
    />
  );

  return (
    <Flex direction="column" gap="5">
      <PageHeader
        title={t("proxy.title")}
        visible={mounted}
        extra={
          <Flex gap="2" wrap="wrap">
            <Button asChild variant="soft" color="gray">
              <Link to="/import">
                <Icon icon="lucide:file-input" width="15" height="15" />
                {t("nav.import")}
              </Link>
            </Button>
            <Button asChild>
              <Link to="/proxies/new">
                <Icon icon="lucide:plus" width="16" height="16" />
                {t("proxy.addProxy")}
              </Link>
            </Button>
          </Flex>
        }
      />
      <Reveal visible={mounted}>
        <div className="resource-stats">
          <StatCard
            title={t("proxy.totalProxies")}
            value={stats.total}
            color="blue"
            icon={<Icon icon="lucide:network" />}
          />
          <StatCard
            title={t("proxy.tunnelOnline")}
            value={stats.online}
            color="green"
            icon={<Icon icon="lucide:circle-check" />}
          />
          <StatCard
            title={t("proxy.notOnlineShort")}
            subtitle={t("proxy.includesDisabled")}
            value={stats.offline}
            color="gray"
            icon={<Icon icon="lucide:pause" />}
          />
        </div>
      </Reveal>
      <Card size="2" className="resource-panel">
        <ResourceListToolbar
          title={t("proxy.allProxies")}
          actions={
            <RefreshButton
              onClick={refreshProxies}
              refreshing={refreshing}
              label={t("proxy.refresh")}
            />
          }
          summary={t("common.filteredCount", { count: totalItems })}
        >
          <SearchField value={search} onChange={setSearch} placeholder={t("proxy.searchProxies")} />
          <div className="resource-filter resource-filter--server">
            <Text size="1" color="gray">
              {t("proxy.server")}
            </Text>
            <Select.Root
              value={filters.serverId}
              onValueChange={(value) => setFilter("serverId", value)}
            >
              <Select.Trigger aria-label={t("common.filterByServer")} />
              <Select.Content>
                <Select.Item value="all">{t("proxy.allServers")}</Select.Item>
                {servers.map((server) => (
                  <Select.Item key={server.id} value={server.id}>
                    {server.serverName}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </div>
          <div className="resource-filter">
            <Text size="1" color="gray">
              {t("proxy.proxyType")}
            </Text>
            <Select.Root value={filters.type} onValueChange={(value) => setFilter("type", value)}>
              <Select.Trigger aria-label={t("common.filterByType")} />
              <Select.Content>
                <Select.Item value="all">{t("proxy.allTypes")}</Select.Item>
                {protocolTypes.map((type) => (
                  <Select.Item value={type} key={type}>
                    {type.toUpperCase()}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </div>
          <div className="resource-filter">
            <Text size="1" color="gray">
              {t("proxy.tunnelState")}
            </Text>
            <Select.Root value={filters.state} onValueChange={(value) => setFilter("state", value)}>
              <Select.Trigger aria-label={t("common.filterByState")} />
              <Select.Content>
                <Select.Item value="all">{t("common.all")}</Select.Item>
                <Select.Item value="online">{t("proxy.tunnelOnline")}</Select.Item>
                <Select.Item value="offline">{t("proxy.filterOffline")}</Select.Item>
                <Select.Item value="disabled">{t("proxy.filterDisabled")}</Select.Item>
              </Select.Content>
            </Select.Root>
          </div>
          {hasFilters && (
            <Button variant="ghost" color="gray" size="2" onClick={resetFilters}>
              {t("common.clearFilters")}
            </Button>
          )}
        </ResourceListToolbar>
        <Text as="p" size="1" color="gray" className="proxy-status-help">
          {t("proxy.stateExplanation")}
        </Text>
        {selected.size > 0 && (
          <div className="proxy-batch-toolbar" role="toolbar" aria-label={t("proxy.batchToolbar")}>
            <Text size="2" weight="medium">
              {t("proxy.selectedCount", { count: selected.size })}
            </Text>
            <Button
              size="1"
              variant="soft"
              disabled={batchBusy || togglingIds.size > 0}
              onClick={() => void runBatch("enable")}
            >
              {t("proxy.batchEnable")}
            </Button>
            <Button
              size="1"
              variant="soft"
              color="gray"
              disabled={batchBusy || togglingIds.size > 0}
              onClick={() => void runBatch("disable")}
            >
              {t("proxy.batchDisable")}
            </Button>
            <Select.Root
              value=""
              onValueChange={(serverId) => void runBatch("move", serverId)}
              disabled={batchBusy || togglingIds.size > 0}
            >
              <Select.Trigger
                variant="soft"
                placeholder={t("proxy.batchMove")}
                aria-label={t("proxy.batchMove")}
              />
              <Select.Content>
                {servers.map((server) => (
                  <Select.Item key={server.id} value={server.id}>
                    {server.serverName}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Button
              size="1"
              variant="soft"
              color="red"
              disabled={batchBusy || togglingIds.size > 0}
              onClick={() => setConfirmBatchDelete(true)}
            >
              {t("common.delete")}
            </Button>
            <Button
              size="1"
              variant="ghost"
              color="gray"
              disabled={batchBusy}
              onClick={() => selectPage(false)}
            >
              {t("proxy.clearSelection")}
            </Button>
          </div>
        )}
        {loading ? (
          <Flex
            align="center"
            justify="center"
            className="resource-empty"
            role="status"
            aria-label={t("common.loading")}
          >
            <Loading size="small" />
          </Flex>
        ) : proxies.length === 0 ? (
          search || hasFilters ? (
            <Flex direction="column" gap="3" align="center" className="resource-empty">
              <Text weight="medium">{t("common.noFilterResults")}</Text>
              <Text size="2" color="gray">
                {t("common.noFilterResultsDesc")}
              </Text>
              <Button
                variant="soft"
                onClick={() => {
                  setSearch("");
                  resetFilters();
                }}
              >
                {t("common.clearFilters")}
              </Button>
            </Flex>
          ) : (
            <EmptyState
              title={t("proxy.noProxies")}
              description={t("proxy.addFirstProxy")}
              actionText={t("proxy.createYourFirstProxy")}
              onAction={() => navigate("/proxies/new")}
            />
          )
        ) : (
          <>
            {mobile ? (
              <div className="resource-cards">
                <Flex gap="2" align="center" p="2">
                  <Checkbox
                    checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
                    disabled={batchBusy}
                    onCheckedChange={(value) => selectPage(value === true)}
                    aria-label={t("proxy.selectPage")}
                  />
                  <Text size="2" color="gray">
                    {t("proxy.selectPage")}
                  </Text>
                </Flex>
                {proxies.map((proxy) => (
                  <Card size="2" key={proxy.id} className="resource-card">
                    <div className="resource-card__header">
                      <Flex gap="3" align="start">
                        <Checkbox
                          checked={selected.has(proxy.id)}
                          disabled={batchBusy}
                          onCheckedChange={() => toggleSelected(proxy.id)}
                          aria-label={t("proxy.selectOne", { name: proxy.name ?? proxy.id })}
                        />
                        {identity(proxy)}
                      </Flex>
                      {actions(proxy)}
                    </div>
                    <div className="resource-card__fields">
                      <div className="resource-card__field">
                        <Text size="1" color="gray">
                          {t("proxy.server")}
                        </Text>
                        {serverLink(proxy)}
                      </div>
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
                        <ProxyHealth
                          proxyId={proxy.id}
                          proxyName={proxy.name ?? ""}
                          status={statuses[proxy.id]}
                          probeDisabled={proxy.probeDisabled}
                        />
                      </div>
                    </div>
                    {proxy.description && (
                      <details className="resource-detail">
                        <summary>{t("common.details")}</summary>
                        <Text as="p" size="2" color="gray" className="resource-detail__body">
                          {proxy.description}
                        </Text>
                      </details>
                    )}
                    <div className="resource-card__footer">
                      <ProxyRuntimeBadge
                        enabled={proxy.status === "enabled"}
                        bootStatus={proxy.bootStatus}
                      />
                      {configuration(proxy)}
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table.Root className="resource-table">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell width="36px">
                        <Checkbox
                          aria-label={t("proxy.selectPage")}
                          checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
                          disabled={batchBusy}
                          onCheckedChange={(value) => selectPage(value === true)}
                        />
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>{t("common.name")}</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>{t("proxy.server")}</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>{t("proxy.mapping")}</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>{t("proxy.tunnelState")}</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>{t("proxy.healthColumn")}</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>
                        {t("proxy.configurationState")}
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell width="48px">
                        <span className="sr-only">{t("common.actions")}</span>
                      </Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {proxies.map((proxy) => (
                      <Table.Row key={proxy.id}>
                        <Table.Cell>
                          <Checkbox
                            aria-label={t("proxy.selectOne", { name: proxy.name ?? proxy.id })}
                            checked={selected.has(proxy.id)}
                            disabled={batchBusy}
                            onCheckedChange={() => toggleSelected(proxy.id)}
                          />
                        </Table.Cell>
                        <Table.Cell>{identity(proxy)}</Table.Cell>
                        <Table.Cell>{serverLink(proxy)}</Table.Cell>
                        <Table.Cell>{mapping(proxy)}</Table.Cell>
                        <Table.Cell>
                          <ProxyRuntimeBadge
                            enabled={proxy.status === "enabled"}
                            bootStatus={proxy.bootStatus}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          <ProxyHealth
                            proxyId={proxy.id}
                            proxyName={proxy.name ?? ""}
                            status={statuses[proxy.id]}
                            probeDisabled={proxy.probeDisabled}
                          />
                        </Table.Cell>
                        <Table.Cell>{configuration(proxy)}</Table.Cell>
                        <Table.Cell>{actions(proxy)}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </div>
            )}
            <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </Card>
      <ConfirmDeleteDialog
        open={confirmBatchDelete}
        title={t("proxy.confirmDeletion")}
        description={t("proxy.batchDeleteConfirm", { count: selected.size })}
        onClose={() => setConfirmBatchDelete(false)}
        onConfirm={() => {
          void runBatch("delete");
          setConfirmBatchDelete(false);
        }}
      />
      <ConfirmDeleteDialog
        open={deleteId !== null}
        title={t("proxy.confirmDeletion")}
        description={t("proxy.deleteConfirmMessage")}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) void deleteProxy(deleteId);
          setDeleteId(null);
        }}
      />
    </Flex>
  );
}
