import { Icon } from "@iconify/react/offline";
import { Badge, Button, Callout, Card, Flex, Table, Text } from "@radix-ui/themes";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { Loading } from "../../components/Loading";
import { PaginationBar } from "../../components/PaginationBar";
import { SearchField } from "../../components/SearchField";
import { RefreshButton } from "../../components/RefreshButton";
import { ConfirmDeleteDialog } from "../../components/ConfirmDeleteDialog";
import { CopyableText } from "../../components/CopyableText";
import { ProxyStatusToggle } from "../../components/ProxyStatusToggle";
import { MoreActions } from "../../components/MoreActions";
import { ResourceListToolbar } from "../../components/ResourceListToolbar";
import { useDelayedMount } from "../../hooks/useDelayedMount";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { formatEndpoint } from "../../lib/endpoints";
import type { Visitor } from "../../types/visitor";

interface VisitorsViewProps {
  visitors: Visitor[];
  loading: boolean;
  refreshing: boolean;
  deleteVisitor: (id: string) => Promise<void>;
  toggleStatus: (visitor: Visitor) => Promise<void>;
  refreshVisitors: () => void;
  page: number;
  setPage: (page: number) => void;
  totalPages: number;
  search: string;
  setSearch: (value: string) => void;
}

export function VisitorsView({
  visitors,
  loading,
  refreshing,
  deleteVisitor,
  toggleStatus,
  refreshVisitors,
  page,
  setPage,
  totalPages,
  search,
  setSearch,
}: VisitorsViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mounted = useDelayedMount();
  const mobile = useMediaQuery("(max-width: 760px)");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const pending = useRef(new Set<string>());
  const handleToggle = async (visitor: Visitor) => {
    if (pending.current.has(visitor.id)) return;
    pending.current.add(visitor.id);
    setTogglingIds(new Set(pending.current));
    try {
      await toggleStatus(visitor);
    } finally {
      pending.current.delete(visitor.id);
      setTogglingIds(new Set(pending.current));
    }
  };
  const actions = (visitor: Visitor) => (
    <MoreActions
      name={visitor.name}
      actions={[
        {
          label: t("common.edit"),
          icon: "lucide:pencil",
          onSelect: () => navigate(`/visitors/${visitor.id}/edit`),
        },
        {
          label: t("common.delete"),
          icon: "lucide:trash-2",
          danger: true,
          onSelect: () => setDeleteId(visitor.id),
        },
      ]}
    />
  );
  const identity = (visitor: Visitor) => (
    <Flex gap="2" direction="column" align="start">
      <Text size="2" weight="bold" style={{ overflowWrap: "anywhere" }}>
        {visitor.name}
      </Text>
      <Badge color="gray" variant="surface" size="1">
        {visitor.visitorType.toUpperCase()}
      </Badge>
    </Flex>
  );
  const server = (visitor: Visitor) =>
    visitor.expand?.serverId ? (
      <Link
        to={`/servers/${visitor.serverId}`}
        style={{ color: "var(--accent-11)", textDecoration: "none", fontSize: 13 }}
      >
        {visitor.expand.serverId.serverName}
      </Link>
    ) : (
      <Text size="2" color="gray">
        —
      </Text>
    );
  const listener = (visitor: Visitor) =>
    visitor.bindPort && visitor.bindPort > 0 ? (
      <CopyableText text={formatEndpoint(visitor.bindAddr || "127.0.0.1", visitor.bindPort)} />
    ) : (
      <Text size="2" color="gray">
        {visitor.bindPort && visitor.bindPort < 0 ? t("dashboard.topologyFallbackOnly") : "—"}
      </Text>
    );
  const configuration = (visitor: Visitor) => (
    <ProxyStatusToggle
      enabled={visitor.status === "enabled"}
      toggling={togglingIds.has(visitor.id)}
      onToggle={() => void handleToggle(visitor)}
    />
  );

  return (
    <Flex direction="column" gap="5">
      <PageHeader
        title={t("visitor.title")}
        visible={mounted}
        extra={
          <Button asChild>
            <Link to="/visitors/new">
              <Icon icon="lucide:plus" width="16" height="16" />
              {t("visitor.add")}
            </Link>
          </Button>
        }
      />
      <Callout.Root size="1" color="gray" variant="surface">
        <Callout.Icon>
          <Icon icon="lucide:info" width="15" height="15" />
        </Callout.Icon>
        <Callout.Text>{t("visitor.explain")}</Callout.Text>
      </Callout.Root>
      <Card size="2" className="resource-panel">
        <ResourceListToolbar
          title={t("visitor.allVisitors")}
          actions={
            <RefreshButton
              onClick={refreshVisitors}
              refreshing={refreshing}
              label={t("proxy.refresh")}
            />
          }
        >
          <SearchField value={search} onChange={setSearch} placeholder={t("visitor.search")} />
        </ResourceListToolbar>
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
        ) : visitors.length === 0 ? (
          search ? (
            <Flex direction="column" gap="3" align="center" className="resource-empty">
              <Text weight="medium">{t("common.noFilterResults")}</Text>
              <Text size="2" color="gray">
                {t("common.noFilterResultsDesc")}
              </Text>
              <Button variant="soft" onClick={() => setSearch("")}>
                {t("common.clearSearch")}
              </Button>
            </Flex>
          ) : (
            <EmptyState
              title={t("visitor.empty")}
              description={t("visitor.emptyDescription")}
              actionText={t("visitor.add")}
              onAction={() => navigate("/visitors/new")}
            />
          )
        ) : (
          <>
            {mobile ? (
              <div className="resource-cards">
                {visitors.map((visitor) => (
                  <Card size="2" className="resource-card" key={visitor.id}>
                    <div className="resource-card__header">
                      {identity(visitor)}
                      {actions(visitor)}
                    </div>
                    <div className="resource-card__fields">
                      <div className="resource-card__field">
                        <Text size="1" color="gray">
                          {t("proxy.server")}
                        </Text>
                        {server(visitor)}
                      </div>
                      <div className="resource-card__field">
                        <Text size="1" color="gray">
                          {t("visitor.target")}
                        </Text>
                        <CopyableText text={visitor.serverName} />
                      </div>
                      <div className="resource-card__field">
                        <Text size="1" color="gray">
                          {t("visitor.localAddress")}
                        </Text>
                        {listener(visitor)}
                      </div>
                    </div>
                    <div className="resource-card__footer">
                      <Text size="1" color="gray">
                        {t("proxy.configurationState")}
                      </Text>
                      {configuration(visitor)}
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table.Root className="resource-table">
                  <Table.Header>
                    <Table.Row>
                      {[
                        "common.name",
                        "proxy.server",
                        "visitor.target",
                        "visitor.localAddress",
                        "proxy.configurationState",
                        "common.actions",
                      ].map((key) => (
                        <Table.ColumnHeaderCell key={key}>{t(key)}</Table.ColumnHeaderCell>
                      ))}
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {visitors.map((visitor) => (
                      <Table.Row key={visitor.id}>
                        <Table.Cell>{identity(visitor)}</Table.Cell>
                        <Table.Cell>{server(visitor)}</Table.Cell>
                        <Table.Cell>
                          <CopyableText text={visitor.serverName} />
                        </Table.Cell>
                        <Table.Cell>{listener(visitor)}</Table.Cell>
                        <Table.Cell>{configuration(visitor)}</Table.Cell>
                        <Table.Cell>{actions(visitor)}</Table.Cell>
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
        title={t("visitor.confirmDeletion")}
        description={t("visitor.deleteConfirmMessage")}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) void deleteVisitor(deleteId);
          setDeleteId(null);
        }}
      />
    </Flex>
  );
}
