import { Button, Card, Flex, Heading, Text, Badge, Table } from "@radix-ui/themes";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Icon } from "@iconify/react/offline";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { AnimateNumber } from "../../components/AnimateNumber";
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
import { Reveal } from "../../components/Reveal";
import { useDelayedMount } from "../../hooks/useDelayedMount";
import type { ServerListItem } from "../../types/server";

interface ServersViewProps {
  servers: ServerListItem[];
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

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
};

export function ServersView({
  servers,
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
  const [deleteId, setDeleteId] = useState<string | null>(null);

  return (
    <>
      <Flex direction="column" gap="5" className="flex flex-1 flex-col">
        {/* Header */}
        <PageHeader
          title={t("server.title")}
          description={t("server.manageServers")}
          visible={mounted}
        />
        {/* Stats Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Reveal visible={mounted} delay={0.1}>
            <StatCard
              title={t("server.totalServers")}
              value={<AnimateNumber value={servers.length} decimalPlaces={0} />}
              color="gray"
              icon={<Icon icon="lucide:hard-drive" width="32" height="32" color="var(--gray-11)" />}
            />
          </Reveal>
          <Reveal visible={mounted} delay={0.2}>
            <StatCard
              title={t("server.running")}
              value={
                <span style={{ color: "var(--green-9)" }}>
                  <AnimateNumber
                    value={servers.filter((s) => s.bootStatus === "running").length}
                    decimalPlaces={0}
                  />
                </span>
              }
              color="green"
              icon={<Icon icon="lucide:rocket" width="32" height="32" color="var(--green-11)" />}
            />
          </Reveal>
          <Reveal visible={mounted} delay={0.3}>
            <StatCard
              title={t("server.stopped")}
              value={
                <span style={{ color: "var(--red-9)" }}>
                  <AnimateNumber
                    value={servers.filter((s) => s.bootStatus === "stopped").length}
                    decimalPlaces={0}
                  />
                </span>
              }
              color="red"
              icon={<Icon icon="lucide:bug" width="32" height="32" color="var(--red-11)" />}
            />
          </Reveal>
        </div>
        {/* Servers Table */}
        <Reveal visible={mounted} delay={0.4} className="flex flex-1 flex-col overflow-hidden">
          <Card className="flex flex-1 flex-col">
            <Flex direction="column" gap="3" mb="4" p="2">
              <Flex justify="between" align="center" wrap="wrap" gap="2">
                <Text size="3" weight="bold">
                  {t("server.allServers")}
                </Text>
                <Flex gap="2" wrap="wrap" align="center">
                  <SearchField
                    value={search}
                    onChange={setSearch}
                    placeholder={t("server.searchServers")}
                  />
                  <RefreshButton
                    onClick={refreshServers}
                    refreshing={refreshing}
                    label={t("server.refresh")}
                  />
                  <Button variant="soft" color="gray" onClick={() => navigate("/import")}>
                    <Icon icon="lucide:file-input" width="16" height="16" />
                    {t("import.title")}
                  </Button>
                  <Button onClick={() => navigate("/servers/new")}>
                    <Icon icon="lucide:plus" width="14" height="14" />
                    {t("server.addServer")}
                  </Button>
                </Flex>
              </Flex>
            </Flex>

            <AnimatePresence mode="wait">
              {loading ? (
                <motion.div key="loading" {...fade} className="flex-1">
                  <Flex
                    direction="column"
                    align="center"
                    justify="center"
                    gap="2"
                    className="h-full py-12"
                  >
                    <Loading size="small" />
                  </Flex>
                </motion.div>
              ) : servers.length === 0 ? (
                search ? (
                  <motion.div key="no-results" {...fade} className="flex-1">
                    <Flex
                      direction="column"
                      align="center"
                      justify="center"
                      gap="2"
                      className="h-full"
                    >
                      <Icon icon="lucide:search" width="32" height="32" color="var(--gray-9)" />
                      <Heading size="4">{t("server.noResultsFound")}</Heading>
                      <Text color="gray" size="2">
                        {t("server.noServersMatch")} "{search}"
                      </Text>
                      <Button variant="soft" mt="2" onClick={() => setSearch("")}>
                        {t("server.clearSearch")}
                      </Button>
                    </Flex>
                  </motion.div>
                ) : (
                  <motion.div key="empty-state" {...fade} className="flex-1">
                    <Flex direction="column" align="center" justify="center" className="h-full">
                      <EmptyState
                        title={t("server.noServers")}
                        description={t("server.addFirstServer")}
                        actionText={t("server.addYourFirstServer")}
                        onAction={() => navigate("/servers/new")}
                      />
                    </Flex>
                  </motion.div>
                )
              ) : (
                <motion.div key="table" {...fade}>
                  <div className="overflow-x-auto">
                    <Table.Root>
                      <Table.Header>
                        <Table.Row>
                          <Table.ColumnHeaderCell>{t("common.name")}</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>{t("server.host")}</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>{t("server.port")}</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>{t("server.latency")}</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>{t("server.location")}</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>{t("server.bootStatus")}</Table.ColumnHeaderCell>
                          <Table.ColumnHeaderCell>{t("common.actions")}</Table.ColumnHeaderCell>
                        </Table.Row>
                      </Table.Header>
                      <Table.Body>
                        {servers.map((server) => (
                          <Table.Row key={server.id}>
                            <Table.Cell>
                              <Link
                                to={`/servers/${server.id}`}
                                style={{ textDecoration: "none", color: "inherit" }}
                              >
                                <Text weight="medium" className="cursor-pointer hover:underline">
                                  {server.serverName}
                                </Text>
                              </Link>
                            </Table.Cell>
                            <Table.Cell>
                              <Text size="2" className="font-mono">
                                {server.serverAddr}
                              </Text>
                            </Table.Cell>
                            <Table.Cell>
                              <Badge variant="surface">{server.serverPort}</Badge>
                            </Table.Cell>
                            <Table.Cell>
                              <ServerLatency networkStatus={server.networkStatus} />
                            </Table.Cell>
                            <Table.Cell>
                              <ServerLocation geoLocation={server.geoLocation} />
                            </Table.Cell>
                            <Table.Cell>
                              <ServerStatusBadge status={server.bootStatus} />
                            </Table.Cell>
                            <Table.Cell>
                              <Flex gap="2">
                                {server.bootStatus === "running" ? (
                                  <Button
                                    size="1"
                                    variant="soft"
                                    className="cursor-pointer"
                                    color="red"
                                    disabled={pendingId !== null}
                                    onClick={() => terminateServer(server.id)}
                                  >
                                    <Icon
                                      icon={pendingId === server.id ? "lucide:loader-2" : "lucide:bug"}
                                      className={pendingId === server.id ? "animate-spin" : ""}
                                      width="14"
                                      height="14"
                                    />
                                    {t("server.stop")}
                                  </Button>
                                ) : (
                                  <Button
                                    size="1"
                                    variant="soft"
                                    className="cursor-pointer"
                                    color="green"
                                    disabled={pendingId !== null}
                                    onClick={() => launchServer(server.id)}
                                  >
                                    <Icon
                                      icon={
                                        pendingId === server.id ? "lucide:loader-2" : "lucide:rocket"
                                      }
                                      className={pendingId === server.id ? "animate-spin" : ""}
                                      width="14"
                                      height="14"
                                    />
                                    {t("server.launch")}
                                  </Button>
                                )}

                                <Link to={`/servers/${server.id}`} style={{ textDecoration: "none" }}>
                                  <Button
                                    size="1"
                                    variant="soft"
                                    className="cursor-pointer"
                                    color="blue"
                                  >
                                    <Icon icon="lucide:eye" width="14" height="14" />
                                    {t("server.view")}
                                  </Button>
                                </Link>

                                <Link
                                  to={`/servers/${server.id}/logs`}
                                  style={{ textDecoration: "none" }}
                                >
                                  <Button
                                    size="1"
                                    variant="soft"
                                    className="cursor-pointer"
                                    color="gray"
                                  >
                                    <Icon icon="lucide:scroll-text" width="14" height="14" />
                                    {t("server.viewLogs")}
                                  </Button>
                                </Link>

                                <Button
                                  size="1"
                                  variant="soft"
                                  className="cursor-pointer"
                                  onClick={() => navigate(`/servers/${server.id}/edit`)}
                                >
                                  <Icon icon="lucide:pencil" width="14" height="14" />
                                  {t("common.edit")}
                                </Button>

                                <Button
                                  size="1"
                                  variant="soft"
                                  className="cursor-pointer"
                                  color="red"
                                  onClick={() => setDeleteId(server.id)}
                                >
                                  <Icon icon="lucide:trash" width="14" height="14" />
                                  {t("common.delete")}
                                </Button>
                              </Flex>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Root>
                  </div>
                  <PaginationBar page={page} totalPages={totalPages} onPageChange={setPage} />
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </Reveal>
      </Flex>

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
    </>
  );
}
