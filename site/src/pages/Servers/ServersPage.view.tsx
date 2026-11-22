import { Button, Card, Flex, Table, Text } from "@radix-ui/themes";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { Loading } from "../../components/Loading";
import { StatCard } from "../../components/StatCard";
import { ServerLatency } from "../../components/ServerLatency";
import { ServerLocation } from "../../components/ServerLocation";
import { ServerStatusBadge } from "../../components/ServerStatusBadge";
import { PaginationBar } from "../../components/PaginationBar";
import { SearchField } from "../../components/SearchField";
import { RefreshButton } from "../../components/RefreshButton";
import { ConfirmDeleteDialog } from "../../components/ConfirmDeleteDialog";
import { CopyableText } from "../../components/CopyableText";
import { MoreActions } from "../../components/MoreActions";
import { ResourceListToolbar } from "../../components/ResourceListToolbar";
import { Reveal } from "../../components/Reveal";
import { useDelayedMount } from "../../hooks/useDelayedMount";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { formatEndpoint } from "../../lib/endpoints";
import type { ServerListItem } from "../../types/server";

interface ServersViewProps {
  servers: ServerListItem[];
  stats: { total: number; running: number; stopped: number };
  loading: boolean;
  refreshing: boolean;
  pendingId: string | null;
  deleteServer: (id: string) => void;
  launchServer: (id: string) => void;
  terminateServer: (id: string) => void;
  search: string;
  setSearch: (value: string) => void;
  refreshServers: () => void;
  page: number;
  setPage: (page: number) => void;
  totalPages: number;
}

export function ServersView({
  servers,
  stats,
  loading,
  refreshing,
  pendingId,
  deleteServer,
  launchServer,
  terminateServer,
  search,
  setSearch,
  refreshServers,
  page,
  setPage,
  totalPages,
}: ServersViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mounted = useDelayedMount();
  const mobile = useMediaQuery("(max-width: 760px)");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const actions = (server: ServerListItem) => (
    <Flex gap="3" align="center">
      <Button
        size="1"
        variant="soft"
        color={server.bootStatus === "running" ? "gray" : "green"}
        disabled={pendingId !== null}
        onClick={() =>
          server.bootStatus === "running" ? terminateServer(server.id) : launchServer(server.id)
        }
      >
        <Icon
          icon={
            pendingId === server.id
              ? "lucide:loader-2"
              : server.bootStatus === "running"
                ? "lucide:square"
                : "lucide:play"
          }
          className={pendingId === server.id ? "animate-spin" : ""}
          width="13"
          height="13"
        />
        {t(server.bootStatus === "running" ? "server.stop" : "server.start")}
      </Button>
      <MoreActions
        name={server.serverName}
        actions={[
          {
            label: t("server.view"),
            icon: "lucide:eye",
            onSelect: () => navigate(`/servers/${server.id}`),
          },
          {
            label: t("server.viewLogs"),
            icon: "lucide:scroll-text",
            onSelect: () => navigate(`/servers/${server.id}/logs`),
          },
          {
            label: t("common.edit"),
            icon: "lucide:pencil",
            onSelect: () => navigate(`/servers/${server.id}/edit`),
          },
          {
            label: t("common.delete"),
            icon: "lucide:trash-2",
            danger: true,
            onSelect: () => setDeleteId(server.id),
          },
        ]}
      />
    </Flex>
  );
  const identity = (server: ServerListItem) => (
    <div className="resource-name">
      <span className="resource-name__icon" aria-hidden="true">
        <Icon icon="lucide:server" width="17" height="17" />
      </span>
      <div className="min-w-0">
        <Link to={`/servers/${server.id}`} className="resource-name__title">
          {server.serverName}
        </Link>
        <div>
          <CopyableText text={formatEndpoint(server.serverAddr, server.serverPort)} color="gray" />
        </div>
      </div>
    </div>
  );

  return (
    <Flex direction="column" gap="5">
      <PageHeader
        title={t("server.title")}
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
              <Link to="/servers/new">
                <Icon icon="lucide:plus" width="16" height="16" />
                {t("server.addServer")}
              </Link>
            </Button>
          </Flex>
        }
      />
      <Reveal visible={mounted}>
        <div className="resource-stats">
          <StatCard
            title={t("server.totalServers")}
            value={stats.total}
            color="blue"
            icon={<Icon icon="lucide:server" />}
            loading={loading && servers.length === 0}
          />
          <StatCard
            title={t("server.running")}
            value={stats.running}
            color="green"
            icon={<Icon icon="lucide:circle-check" />}
            loading={loading && servers.length === 0}
          />
          <StatCard
            title={t("server.stopped")}
            value={stats.stopped}
            color="gray"
            icon={<Icon icon="lucide:pause" />}
            loading={loading && servers.length === 0}
          />
        </div>
      </Reveal>
      <Card size="2" className="resource-panel">
        <ResourceListToolbar
          title={t("server.allServers")}
          actions={
            <RefreshButton
              onClick={refreshServers}
              refreshing={refreshing}
              label={t("server.refresh")}
            />
          }
        >
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={t("server.searchServers")}
          />
        </ResourceListToolbar>
        {loading ? (
          <Flex
            className="resource-empty"
            align="center"
            justify="center"
            role="status"
            aria-label={t("common.loading")}
          >
            <Loading size="small" />
          </Flex>
        ) : servers.length === 0 ? (
          search ? (
            <Flex direction="column" gap="3" align="center" className="resource-empty">
              <Text weight="medium">{t("server.noResultsFound")}</Text>
              <Text size="2" color="gray">
                {t("server.noServersMatch")}
              </Text>
              <Button variant="soft" onClick={() => setSearch("")}>
                {t("server.clearSearch")}
              </Button>
            </Flex>
          ) : (
            <EmptyState
              title={t("server.noServers")}
              description={t("server.addFirstServer")}
              actionText={t("server.addYourFirstServer")}
              onAction={() => navigate("/servers/new")}
            />
          )
        ) : (
          <>
            {mobile ? (
              <div className="resource-cards">
                {servers.map((server) => (
                  <Card key={server.id} size="2" className="resource-card">
                    <div className="resource-card__header">{identity(server)}</div>
                    <div className="resource-card__fields">
                      <div className="resource-card__field">
                        <Text size="1" color="gray">
                          {t("server.latency")}
                        </Text>
                        <ServerLatency networkStatus={server.networkStatus} />
                      </div>
                      <div className="resource-card__field">
                        <Text size="1" color="gray">
                          {t("server.location")}
                        </Text>
                        <ServerLocation geoLocation={server.geoLocation} />
                      </div>
                    </div>
                    {server.description && (
                      <details className="resource-detail">
                        <summary>{t("common.details")}</summary>
                        <Text as="p" size="2" color="gray" className="resource-detail__body">
                          {server.description}
                        </Text>
                      </details>
                    )}
                    <div className="resource-card__footer">
                      <ServerStatusBadge status={server.bootStatus} variant="soft" />
                      {actions(server)}
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table.Root className="resource-table">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeaderCell>{t("common.name")}</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>{t("server.latency")}</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>{t("server.location")}</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>{t("server.bootStatus")}</Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell>{t("common.actions")}</Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {servers.map((server) => (
                      <Table.Row key={server.id}>
                        <Table.Cell>{identity(server)}</Table.Cell>
                        <Table.Cell>
                          <ServerLatency networkStatus={server.networkStatus} />
                        </Table.Cell>
                        <Table.Cell>
                          <ServerLocation geoLocation={server.geoLocation} />
                        </Table.Cell>
                        <Table.Cell>
                          <ServerStatusBadge status={server.bootStatus} variant="soft" />
                        </Table.Cell>
                        <Table.Cell>{actions(server)}</Table.Cell>
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
        open={deleteId !== null}
        title={t("server.confirmDeletion")}
        description={t("server.deleteConfirmMessage")}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteServer(deleteId);
          setDeleteId(null);
        }}
      />
    </Flex>
  );
}
