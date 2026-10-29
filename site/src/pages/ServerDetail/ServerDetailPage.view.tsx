import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Flex, Text, Badge, Grid, Button, Heading, Box, Table } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../../components/PageHeader";
import { Loading } from "../../components/Loading";
import { ServerLocation } from "../../components/ServerLocation";
import { ServerStatusBadge } from "../../components/ServerStatusBadge";
import { ProbeHistory } from "../../components/ProbeHistory";
import { LatencyChart } from "../../components/LatencyChart";
import { ServerLogViewer } from "../../components/ServerLogViewer";
import { RefreshButton } from "../../components/RefreshButton";
import { ConfirmDeleteDialog } from "../../components/ConfirmDeleteDialog";
import { CopyableText } from "../../components/CopyableText";
import { ProxyEndpoints } from "../../components/ProxyEndpoints";
import { ProxyStatusToggle } from "../../components/ProxyStatusToggle";
import { Reveal } from "../../components/Reveal";
import { useDelayedMount } from "../../hooks/useDelayedMount";
import type { useServerDetail } from "./useServerDetail";

type ServerDetailViewProps = ReturnType<typeof useServerDetail>;

export function ServerDetailView({
  serverId,
  server,
  loading,
  error,
  actionLoading,
  handleStart,
  handleStop,
  proxies: { proxies, togglingId, toggleStatus, deleteProxy, refreshing, refresh },
  probeHistory,
}: ServerDetailViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mounted = useDelayedMount();
  const [deleteProxyId, setDeleteProxyId] = useState<string | null>(null);

  if (loading) {
    return (
      <Flex justify="center" align="center" style={{ height: "100%" }}>
        <Loading />
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex direction="column" justify="center" align="center" style={{ height: "100%" }} gap="4">
        <Icon icon="lucide:alert-circle" width="48" height="48" color="var(--red-9)" />
        <Heading size="4" color="red">
          {t("server.failedToLoad")}
        </Heading>
        <Text color="gray">{error}</Text>
        <Button variant="soft" onClick={() => navigate("/servers")}>
          {t("server.backToServers")}
        </Button>
      </Flex>
    );
  }

  if (!server || !serverId) return null;

  return (
    <Flex direction="column" gap="5" className="flex-1">
      {/* Header */}
      <PageHeader
        title={server.serverName}
        description={t("server.detailsAndLogs")}
        visible={mounted}
        extra={
          <Flex gap="3" align="center">
            <Button variant="soft" color="gray" onClick={() => navigate("/servers")}>
              <Icon icon="lucide:arrow-left" width="16" height="16" />
              {t("server.backToServers")}
            </Button>
            {server.bootStatus === "running" ? (
              <Button size="2" color="red" variant="soft" onClick={handleStop} disabled={actionLoading}>
                {actionLoading ? (
                  <Icon icon="lucide:loader-2" className="animate-spin" />
                ) : (
                  <Icon icon="lucide:square" width="16" height="16" />
                )}
                {t("server.stop")}
              </Button>
            ) : (
              <Button size="2" color="green" variant="soft" onClick={handleStart} disabled={actionLoading}>
                {actionLoading ? (
                  <Icon icon="lucide:loader-2" className="animate-spin" />
                ) : (
                  <Icon icon="lucide:play" width="16" height="16" />
                )}
                {t("server.start")}
              </Button>
            )}
          </Flex>
        }
      />

      <Grid columns={{ initial: "1", md: "2" }} gap="4">
        {/* Basic Info Card */}
        <Reveal visible={mounted} delay={0.1}>
          <Card size="3">
            <Flex direction="column" gap="4">
              <Heading size="4">{t("server.basicInformation")}</Heading>

              <Grid columns={{ initial: "1", md: "2" }} gap="4">
                <Box>
                  <Text size="2" color="gray">
                    {t("server.hostAddress")}
                  </Text>
                  <Text as="div" size="3" weight="medium">
                    {server.serverAddr}
                  </Text>
                </Box>
                <Box>
                  <Text size="2" color="gray">
                    {t("server.port")}
                  </Text>
                  <Text as="div" size="3" weight="medium">
                    {server.serverPort}
                  </Text>
                </Box>
                {server.user && (
                  <Box>
                    <Text size="2" color="gray">
                      {t("server.user")}
                    </Text>
                    <Text as="div" size="3" weight="medium">
                      {server.user}
                    </Text>
                  </Box>
                )}

                <Box>
                  <Text size="2" color="gray">
                    {t("server.location")}
                  </Text>
                  <Box mt="1">
                    <ServerLocation geoLocation={server.geoLocation} size="3" />
                  </Box>
                </Box>
                <Box>
                  <Text size="2" color="gray">
                    {t("common.status")}
                  </Text>
                  <Flex align="center" gap="2" mt="1">
                    <ServerStatusBadge status={server.bootStatus} variant="soft" />
                  </Flex>
                </Box>
                <Box>
                  <Text size="2" color="gray">
                    {t("server.protocol")}
                  </Text>
                  <Text as="div" size="3" weight="medium" style={{ textTransform: "uppercase" }}>
                    {server.transport?.protocol || "TCP"}
                  </Text>
                </Box>
                <Box>
                  <Text size="2" color="gray">
                    {t("server.createdAt")}
                  </Text>
                  <Text as="div" size="3">
                    {new Date(server.created).toLocaleString()}
                  </Text>
                </Box>
                <Box>
                  <Text size="2" color="gray">
                    {t("server.lastUpdated")}
                  </Text>
                  <Text as="div" size="3">
                    {new Date(server.updated).toLocaleString()}
                  </Text>
                </Box>
              </Grid>
            </Flex>
          </Card>
        </Reveal>

        {/* Configuration Summary */}
        <Reveal visible={mounted} delay={0.2}>
          <Card size="3" style={{ height: "100%" }}>
            <Flex direction="column" gap="4">
              <Heading size="4">{t("server.configuration")}</Heading>
              <Box>
                <Text size="2" color="gray">
                  {t("common.description")}
                </Text>
                <Text as="div" size="3">
                  {server.description || t("server.noDescription")}
                </Text>
              </Box>

              {server.transport?.tls?.enable && (
                <Flex align="center" gap="2">
                  <Text size="2" color="gray">
                    {t("server.tls")}
                  </Text>
                  <Badge color="blue" variant="soft">
                    {t("server.enabled")}
                  </Badge>
                </Flex>
              )}

              {server.transport?.proxyURL && (
                <Box>
                  <Text size="2" color="gray">
                    {t("server.proxyURL")}
                  </Text>
                  <Text as="div" size="3" style={{ wordBreak: "break-all" }}>
                    {server.transport.proxyURL}
                  </Text>
                </Box>
              )}
            </Flex>
          </Card>
        </Reveal>
      </Grid>

      {/* Probe History */}
      <Reveal visible={mounted} delay={0.3}>
        <Card size="3">
          <Flex direction="column" gap="3">
            <Heading size="4">{t("server.statusCard")}</Heading>
            <ProbeHistory
              points={probeHistory.points}
              fetchedAt={probeHistory.fetchedAt}
              loading={probeHistory.loading}
            />
          </Flex>
        </Card>
      </Reveal>

      {/* Latency Chart */}
      <Reveal visible={mounted} delay={0.35}>
        <Card size="3">
          <Flex direction="column" gap="3">
            <Heading size="4">{t("server.latencyChartCard")}</Heading>
            <LatencyChart points={probeHistory.points} loading={probeHistory.loading} />
          </Flex>
        </Card>
      </Reveal>

      {/* Proxy List */}
      <Reveal visible={mounted} delay={0.3}>
        <Card size="3">
          <Flex justify="between" align="center" mb="4">
            <Heading size="4">{t("proxy.title")}</Heading>
            <Flex gap="2">
              <RefreshButton
                size="1"
                onClick={refresh}
                refreshing={refreshing}
                label={t("proxy.refresh")}
              />
              <Button size="1" onClick={() => navigate(`/proxies/new?serverId=${serverId}`)}>
                <Icon icon="lucide:plus" width="14" height="14" />
                {t("proxy.addProxy")}
              </Button>
            </Flex>
          </Flex>

          {proxies.length === 0 ? (
            <Flex direction="column" align="center" gap="2" py="6">
              <Icon icon="lucide:network" width="32" height="32" color="var(--gray-8)" />
              <Text size="2" color="gray">
                {t("proxy.noProxies")}
              </Text>
            </Flex>
          ) : (
            <div className="overflow-x-auto">
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>{t("common.name")}</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>{t("common.type")}</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>{t("proxy.localIP")}</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>{t("proxy.localPort")}</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>{t("proxy.remotePortOrDomain")}</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>{t("proxy.bootStatus")}</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>{t("common.status")}</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>{t("common.actions")}</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {proxies.map((proxy) => (
                    <Table.Row key={proxy.id}>
                      <Table.Cell>
                        <Text weight="medium">{proxy.name || <Text color="gray">-</Text>}</Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge variant="surface">{proxy.proxyType.toUpperCase()}</Badge>
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
                        <ProxyEndpoints proxy={proxy} serverAddr={server.serverAddr} />
                      </Table.Cell>
                      <Table.Cell>
                        <Badge radius="full" color={proxy.bootStatus === "online" ? "green" : "red"}>
                          <span
                            className={`status-dot ${
                              proxy.bootStatus === "online" ? "status-dot-green" : "status-dot-red"
                            }`}
                          />
                          {proxy.bootStatus === "online" ? t("proxy.online") : t("proxy.offline")}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <ProxyStatusToggle
                          enabled={proxy.status === "enabled"}
                          toggling={togglingId === proxy.id}
                          onToggle={() => void toggleStatus(proxy)}
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
                            color="red"
                            onClick={() => setDeleteProxyId(proxy.id)}
                          >
                            <Icon icon="lucide:trash-2" width="14" height="14" />
                            {t("common.delete")}
                          </Button>
                        </Flex>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </div>
          )}
        </Card>
      </Reveal>

      {/* Logs Section */}
      <Reveal visible={mounted} delay={0.3}>
        <Card size="3">
          <ServerLogViewer serverId={serverId} />
        </Card>
      </Reveal>

      <ConfirmDeleteDialog
        open={deleteProxyId !== null}
        title={t("proxy.confirmDeletion")}
        description={t("proxy.deleteConfirmMessage")}
        onClose={() => setDeleteProxyId(null)}
        onConfirm={() => {
          if (deleteProxyId) void deleteProxy(deleteProxyId);
          setDeleteProxyId(null);
        }}
      />
    </Flex>
  );
}
