import { Icon } from "@iconify/react/offline";
import { Badge, Button, Callout, Card, Flex, Table, Text } from "@radix-ui/themes";
import { useState } from "react";
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
import { Reveal } from "../../components/Reveal";
import { useDelayedMount } from "../../hooks/useDelayedMount";
import type { Visitor } from "../../types/visitor";

interface VisitorsViewProps {
  visitors: Visitor[];
  /** True until the first page has loaded. */
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
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const handleToggle = async (visitor: Visitor) => {
    if (togglingId === visitor.id) return;
    setTogglingId(visitor.id);
    await toggleStatus(visitor);
    setTogglingId(null);
  };

  return (
    <>
      <Flex direction="column" gap="5" className="flex flex-1 flex-col">
        <PageHeader title={t("visitor.title")} description={t("visitor.description")} visible={mounted} />

        <Reveal visible={mounted} delay={0.1}>
          <Callout.Root size="1" color="gray" variant="surface">
            <Callout.Icon>
              <Icon icon="lucide:info" width="14" height="14" />
            </Callout.Icon>
            <Callout.Text>{t("visitor.explain")}</Callout.Text>
          </Callout.Root>
        </Reveal>

        <Reveal visible={mounted} delay={0.2} className="flex flex-1 flex-col overflow-hidden">
          <Card className="flex flex-1 flex-col">
            <Flex direction="column" gap="3" mb="4" p="2">
              <Flex justify="between" align="center" wrap="wrap" gap="2">
                <Text size="3" weight="bold">
                  {t("visitor.allVisitors")}
                </Text>
                <Flex gap="2" wrap="wrap" align="center">
                  <SearchField value={search} onChange={setSearch} placeholder={t("visitor.search")} />
                  <RefreshButton onClick={refreshVisitors} refreshing={refreshing} label={t("proxy.refresh")} />
                  <Button onClick={() => navigate("/visitors/new")}>
                    <Icon icon="lucide:plus" width="16" height="16" />
                    {t("visitor.add")}
                  </Button>
                </Flex>
              </Flex>
            </Flex>

            {loading ? (
              <Flex align="center" justify="center" className="py-12">
                <Loading size="small" />
              </Flex>
            ) : visitors.length === 0 ? (
              <EmptyState
                title={t("visitor.empty")}
                description={t("visitor.emptyDescription")}
                actionText={t("visitor.add")}
                onAction={() => navigate("/visitors/new")}
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table.Root>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell>{t("common.name")}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("common.type")}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("proxy.server")}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("visitor.target")}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("visitor.localAddress")}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("common.status")}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t("common.actions")}</Table.ColumnHeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {visitors.map((visitor) => {
                        const server = visitor.expand?.serverId;
                        return (
                          <Table.Row key={visitor.id}>
                            <Table.Cell>
                              <Text weight="medium">{visitor.name}</Text>
                            </Table.Cell>
                            <Table.Cell>
                              <Badge variant="surface">{visitor.visitorType.toUpperCase()}</Badge>
                            </Table.Cell>
                            <Table.Cell>
                              {server ? (
                                <Link to={`/servers/${visitor.serverId}`} style={{ textDecoration: "none" }}>
                                  <Text size="2" color="blue">
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
                              <CopyableText text={visitor.serverName} />
                            </Table.Cell>
                            <Table.Cell>
                              {visitor.bindPort && visitor.bindPort > 0 ? (
                                <CopyableText text={`${visitor.bindAddr || "127.0.0.1"}:${visitor.bindPort}`} />
                              ) : (
                                <Text size="2" color="gray">
                                  {visitor.bindPort && visitor.bindPort < 0 ? t("dashboard.topologyFallbackOnly") : "-"}
                                </Text>
                              )}
                            </Table.Cell>
                            <Table.Cell>
                              <ProxyStatusToggle
                                enabled={visitor.status === "enabled"}
                                toggling={togglingId === visitor.id}
                                onToggle={() => handleToggle(visitor)}
                              />
                            </Table.Cell>
                            <Table.Cell>
                              <Flex gap="2">
                                <Button size="1" variant="soft" onClick={() => navigate(`/visitors/${visitor.id}/edit`)}>
                                  <Icon icon="lucide:pencil" width="14" height="14" />
                                  {t("common.edit")}
                                </Button>
                                <Button size="1" variant="soft" color="red" onClick={() => setDeleteId(visitor.id)}>
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
        open={deleteId !== null}
        title={t("visitor.confirmDeletion")}
        description={t("visitor.deleteConfirmMessage")}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) void deleteVisitor(deleteId);
          setDeleteId(null);
        }}
      />
    </>
  );
}
