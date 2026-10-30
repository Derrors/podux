import { Icon } from "@iconify/react/offline";
import { Badge, Button, Card, Checkbox, Flex, Select, Table, Text } from "@radix-ui/themes";
import { useState } from "react";
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
import { ExpiryBadge, ProxyHealth } from "../../components/ProxyHealth";
import type { ProxyStatus } from "../../hooks/useProxyStatus";
import type { ServerOption } from "./ProxyFormPage/useProxyForm";
import { Reveal } from "../../components/Reveal";
import { useDelayedMount } from "../../hooks/useDelayedMount";
import type { Proxy } from "../../types/proxy";

interface ProxiesViewProps {
  proxies: Proxy[];
  /** True until the first page has loaded. */
  loading: boolean;
  refreshing: boolean;
  stats: {
    total: number;
    online: number;
    offline: number;
  };
  deleteProxy: (id: string) => Promise<void>;
  toggleStatus: (proxy: Proxy) => Promise<void>;
  statuses: Record<string, ProxyStatus>;
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
  search: string;
  setSearch: (value: string) => void;
}

export function ProxiesView({
  proxies,
  loading,
  refreshing,
  stats,
  deleteProxy,
  toggleStatus,
  statuses,
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
  search,
  setSearch,
}: ProxiesViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mounted = useDelayedMount();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const allSelected = proxies.length > 0 && proxies.every((p) => selected.has(p.id));

  const handleToggle = async (proxy: Proxy) => {
    if (togglingId === proxy.id) return;
    setTogglingId(proxy.id);
    await toggleStatus(proxy);
    setTogglingId(null);
  };

  return (
    <>
      <Flex direction="column" gap="5" className="flex flex-1 flex-col">
        {/* Header */}
        <PageHeader
          title={t("proxy.title")}
          description={t("proxy.manageProxies")}
          visible={mounted}
        />

        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Reveal visible={mounted} delay={0.1}>
            <StatCard
              title={t("proxy.totalProxies")}
              value={stats.total}
              color="gray"
              icon={<Icon icon="lucide:network" width="32" height="32" color="var(--gray-11)" />}
            />
          </Reveal>
          <Reveal visible={mounted} delay={0.2}>
            <StatCard
              title={t("proxy.online")}
              value={<span style={{ color: "var(--green-9)" }}>{stats.online}</span>}
              color="green"
              icon={
                <Icon icon="lucide:check-circle" width="32" height="32" color="var(--green-11)" />
              }
            />
          </Reveal>
          <Reveal visible={mounted} delay={0.3}>
            <StatCard
              title={t("proxy.offline")}
              value={<span style={{ color: "var(--red-9)" }}>{stats.offline}</span>}
              color="red"
              icon={<Icon icon="lucide:x-circle" width="32" height="32" color="var(--red-11)" />}
            />
          </Reveal>
        </div>

        {/* Proxies Table */}
        <Reveal visible={mounted} delay={0.4} className="flex flex-1 flex-col overflow-hidden">
          <Card className="flex flex-1 flex-col">
            <Flex direction="column" gap="3" mb="4" p="2">
              <Flex justify="between" align="center" wrap="wrap" gap="2">
                <Text size="3" weight="bold">
                  {t("proxy.allProxies")}
                </Text>
                <Flex gap="2" wrap="wrap" align="center">
                  <SearchField
                    value={search}
                    onChange={setSearch}
                    placeholder={t("proxy.searchProxies")}
                  />
                  <RefreshButton
                    onClick={refreshProxies}
                    refreshing={refreshing}
                    label={t("proxy.refresh")}
                  />
                  <Button variant="soft" color="gray" onClick={() => navigate("/import")}>
                    <Icon icon="lucide:file-input" width="16" height="16" />
                    {t("nav.import")}
                  </Button>
                  <Button onClick={() => navigate("/proxies/new")}>
                    <Icon icon="lucide:plus" width="16" height="16" />
                    {t("proxy.addProxy")}
                  </Button>
                </Flex>
              </Flex>
            </Flex>

            {selected.size > 0 && (
              <Flex
                gap="2"
                align="center"
                wrap="wrap"
                mx="2"
                mb="3"
                p="2"
                className="rounded-lg bg-[var(--accent-a3)]"
                role="toolbar"
                aria-label={t("proxy.batchToolbar")}
              >
                <Text size="2" weight="medium" mr="2">
                  {t("proxy.selectedCount", { count: selected.size })}
                </Text>
                <Button size="1" variant="soft" color="green" disabled={batchBusy} onClick={() => runBatch("enable")}>
                  <Icon icon="lucide:power" width="14" height="14" />
                  {t("proxy.batchEnable")}
                </Button>
                <Button size="1" variant="soft" color="gray" disabled={batchBusy} onClick={() => runBatch("disable")}>
                  <Icon icon="lucide:power-off" width="14" height="14" />
                  {t("proxy.batchDisable")}
                </Button>
                <Select.Root value="" onValueChange={(serverId) => runBatch("move", serverId)} disabled={batchBusy}>
                  <Select.Trigger variant="soft" placeholder={t("proxy.batchMove")} />
                  <Select.Content>
                    {servers.map((s) => (
                      <Select.Item key={s.id} value={s.id}>
                        {s.serverName}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                <Button size="1" variant="soft" color="red" disabled={batchBusy} onClick={() => setConfirmBatchDelete(true)}>
                  <Icon icon="lucide:trash-2" width="14" height="14" />
                  {t("common.delete")}
                </Button>
                <Button size="1" variant="ghost" color="gray" onClick={() => selectPage(false)}>
                  {t("proxy.clearSelection")}
                </Button>
              </Flex>
            )}

            {loading ? (
              <Flex align="center" justify="center" className="py-12">
                <Loading size="small" />
              </Flex>
            ) : proxies.length === 0 ? (
              <EmptyState
                title={t("proxy.noProxies")}
                description={t("proxy.addFirstProxy")}
                actionText={t("proxy.createYourFirstProxy")}
                onAction={() => navigate("/proxies/new")}
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table.Root>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell width="36px">
                          <Checkbox
                            aria-label={t("proxy.selectPage")}
                            checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
                            onCheckedChange={(v) => selectPage(v === true)}
                          />
                        </Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("common.name")}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("common.type")}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("proxy.server")}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("proxy.localIP")}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("proxy.localPort")}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("proxy.remotePortOrDomain")}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("proxy.bootStatus")}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("proxy.healthColumn")}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("common.status")}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("common.actions")}</Table.ColumnHeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {proxies.map((proxy) => {
                        const server = proxy.expand?.serverId;
                        return (
                          <Table.Row key={proxy.id}>
                            <Table.Cell>
                              <Checkbox
                                aria-label={proxy.name}
                                checked={selected.has(proxy.id)}
                                onCheckedChange={() => toggleSelected(proxy.id)}
                              />
                            </Table.Cell>
                            <Table.Cell>
                              <Flex direction="column" gap="1" align="start">
                                <Text weight="medium">{proxy.name || <Text color="gray">-</Text>}</Text>
                                <ExpiryBadge expiresAt={proxy.expiresAt} />
                              </Flex>
                            </Table.Cell>
                            <Table.Cell>
                              <Badge variant="surface">{proxy.proxyType.toUpperCase()}</Badge>
                            </Table.Cell>
                            <Table.Cell>
                              {server ? (
                                <Link
                                  to={`/servers/${proxy.serverId}`}
                                  style={{ textDecoration: "none" }}
                                >
                                  <Text size="2" color="blue" style={{ cursor: "pointer" }}>
                                    {server.serverName}
                                  </Text>
                                </Link>
                              ) : (
                                <Text size="2" color="gray">
                                  -
                                </Text>
                              )}
                            </Table.Cell>
                            <Table.Cell>
                              <CopyableText text={proxy.localIP || "127.0.0.1"} color="gray" />
                            </Table.Cell>
                            <Table.Cell>
                              {proxy.localPort ? (
                                <CopyableText text={String(proxy.localPort)} />
                              ) : (
                                <Text size="2" color="gray">
                                  -
                                </Text>
                              )}
                            </Table.Cell>
                            <Table.Cell>
                              <ProxyEndpoints proxy={proxy} serverAddr={server?.serverAddr} />
                            </Table.Cell>
                            <Table.Cell>
                              <Badge
                                radius="full"
                                color={proxy.bootStatus === "online" ? "green" : "red"}
                                className={`animate-status-appear ${
                                  proxy.bootStatus === "online"
                                    ? "animate-status-pulse"
                                    : "animate-status-fade"
                                }`}
                              >
                                <span
                                  className={`status-dot ${
                                    proxy.bootStatus === "online"
                                      ? "status-dot-green"
                                      : "status-dot-red"
                                  }`}
                                />
                                {proxy.bootStatus === "online"
                                  ? t("proxy.online")
                                  : t("proxy.offline")}
                              </Badge>
                            </Table.Cell>
                            <Table.Cell>
                              <ProxyHealth proxyId={proxy.id} proxyName={proxy.name ?? ""} status={statuses[proxy.id]} />
                            </Table.Cell>
                            <Table.Cell>
                              <ProxyStatusToggle
                                enabled={proxy.status === "enabled"}
                                toggling={togglingId === proxy.id}
                                onToggle={() => handleToggle(proxy)}
                              />
                            </Table.Cell>
                            <Table.Cell>
                              <Flex gap="2">
                                <Button
                                  size="1"
                                  variant="soft"
                                  onClick={() => navigate(`/proxies/${proxy.id}/edit`)}
                                >
                                  <Icon icon="lucide:pencil" width="14" height="14" />
                                  {t("common.edit")}
                                </Button>
                                <Button
                                  size="1"
                                  variant="soft"
                                  color="gray"
                                  onClick={() => navigate(`/proxies/new?from=${proxy.id}`)}
                                >
                                  <Icon icon="lucide:copy" width="14" height="14" />
                                  {t("proxy.clone")}
                                </Button>
                                <Button
                                  size="1"
                                  variant="soft"
                                  color="red"
                                  onClick={() => setDeleteId(proxy.id)}
                                >
                                  <Icon icon="lucide:trash-2" width="14" height="14" />
                                  {t("common.delete")}
                                </Button>
                              </Flex>
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
                    </Table.Body>
                  </Table.Root>
                </div>
                <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} />
              </>
            )}
          </Card>
        </Reveal>
      </Flex>

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
    </>
  );
}
