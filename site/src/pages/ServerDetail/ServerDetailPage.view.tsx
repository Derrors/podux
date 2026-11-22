import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Flex, Text, Badge, Grid, Button, Heading, Box } from "@radix-ui/themes";
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
import { ExportConfigDialog } from "../../components/ExportConfigDialog";
import { ConfirmDeleteDialog } from "../../components/ConfirmDeleteDialog";
import { ServerProxyList } from "../../components/ServerProxyList";
import { formatBytes } from "../../lib/format";
import { AdvancedSection } from "../../components/AdvancedSection";
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
  proxyStatuses,
  frps,
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
    <Flex direction="column" gap="5" className="server-detail">
      {/* Header */}
      <PageHeader
        title={server.serverName}
        visible={mounted}
        extra={
          <Flex gap="3" align="center" wrap="wrap">
            <Button variant="soft" color="gray" onClick={() => navigate("/servers")}>
              <Icon icon="lucide:arrow-left" width="16" height="16" />
              {t("server.backToServers")}
            </Button>
            <ExportConfigDialog serverId={serverId} serverName={server.serverName} />
            {server.bootStatus === "running" ? (
              <Button
                size="2"
                color="red"
                variant="soft"
                onClick={handleStop}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <Icon icon="lucide:loader-2" className="animate-spin" />
                ) : (
                  <Icon icon="lucide:square" width="16" height="16" />
                )}
                {t("server.stop")}
              </Button>
            ) : (
              <Button
                size="2"
                color="green"
                variant="soft"
                onClick={handleStart}
                disabled={actionLoading}
              >
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

      {/* frps dashboard */}
      {frps?.configured && (
        <Reveal visible={mounted} delay={0.25}>
          <Card size="3">
            <Flex direction="column" gap="3">
              <Heading size="4">{t("server.frpsCard")}</Heading>
              {frps.info ? (
                <Grid columns={{ initial: "2", md: "5" }} gap="4">
                  {[
                    [t("server.frpsVersion"), frps.info.version],
                    [t("server.frpsTrafficIn"), formatBytes(frps.info.totalTrafficIn)],
                    [t("server.frpsTrafficOut"), formatBytes(frps.info.totalTrafficOut)],
                    [t("server.frpsConns"), String(frps.info.curConns)],
                    [t("server.frpsClients"), String(frps.info.clientCounts)],
                  ].map(([label, value]) => (
                    <Box key={label}>
                      <Text size="2" color="gray">
                        {label}
                      </Text>
                      <Text as="div" size="4" weight="medium">
                        {value}
                      </Text>
                    </Box>
                  ))}
                </Grid>
              ) : (
                <Text size="2" color="red">
                  {t("server.dashboardFailed")}: {frps.error}
                </Text>
              )}
            </Flex>
          </Card>
        </Reveal>
      )}

      <div className="server-detail__monitoring">
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
      </div>
      {/* Proxy List */}
      <Reveal visible={mounted} delay={0.3}>
        <Card size="3">
          <Flex justify="between" align="center" mb="4" wrap="wrap" gap="3">
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

          <ServerProxyList
            proxies={proxies}
            statuses={proxyStatuses}
            subdomainHost={frps?.info?.subdomainHost}
            togglingId={togglingId}
            onToggle={(proxy) => void toggleStatus(proxy)}
            onEdit={(proxy) => navigate(`/proxies/${proxy.id}/edit`)}
            onDelete={(proxy) => setDeleteProxyId(proxy.id)}
          />
        </Card>
      </Reveal>

      {/* Logs Section */}
      <Reveal visible={mounted} delay={0.3}>
        <AdvancedSection title={t("server.connectionLogs")} description={t("server.viewLogsDesc")}>
          <ServerLogViewer serverId={serverId} />
        </AdvancedSection>
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
