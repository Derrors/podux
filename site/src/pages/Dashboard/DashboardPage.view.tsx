import { Icon } from "@iconify/react/offline";
import { Button, Card, Flex, Heading, Skeleton, Text, Tooltip } from "@radix-ui/themes";
import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { useDashboard } from "./useDashboard";
import { ProxyDistribution } from "./ProxyDistribution";
import { PageHeader } from "../../components/PageHeader";
import { StatCard } from "../../components/StatCard";
import { RefreshButton } from "../../components/RefreshButton";
import { Reveal } from "../../components/Reveal";
import { useDelayedMount } from "../../hooks/useDelayedMount";
import { formatBytes } from "../../lib/format";

const TopologyChart = lazy(() =>
  import("./TopologyChart").then((module) => ({ default: module.TopologyChart }))
);
type DashboardViewProps = ReturnType<typeof useDashboard>;

export function DashboardView({
  stats,
  topology,
  statsLoading,
  topologyLoading,
  statsFailed,
  topologyFailed,
  statsRefreshing,
  topologyRefreshing,
  statsUpdatedAt,
  loadStats,
  loadTopology,
}: DashboardViewProps) {
  const { t, i18n } = useTranslation();
  const mounted = useDelayedMount();
  const hasStats = statsUpdatedAt !== null;
  const uptime = t("dashboard.uptimeValue", {
    days: Math.floor(stats.uptimeSeconds / 86400),
    hours: Math.floor((stats.uptimeSeconds % 86400) / 3600),
    minutes: Math.floor((stats.uptimeSeconds % 3600) / 60),
  });
  const refresh = () => {
    void loadStats();
    void loadTopology();
  };

  return (
    <Flex direction="column" gap="5">
      <PageHeader
        title={t("dashboard.title")}
        visible={mounted}
        extra={
          <Flex gap="2" align="center" wrap="wrap">
            <RefreshButton
              onClick={refresh}
              refreshing={statsRefreshing || topologyRefreshing}
              label={t("dashboard.refresh")}
            />
            <Button asChild variant="soft" color="gray">
              <Link to="/import">
                <Icon icon="lucide:file-input" width="16" height="16" />
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
      <div className="dashboard-summary-row">
        <Icon icon="lucide:refresh-cw" width="13" height="13" aria-hidden="true" />
        <span>{t("dashboard.autoRefresh")}</span>
        {statsUpdatedAt && (
          <Tooltip content={t("dashboard.samplingHint")}>
            <time dateTime={statsUpdatedAt.toISOString()}>
              {t("dashboard.updatedAt", {
                time: statsUpdatedAt.toLocaleTimeString(i18n.language, {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                }),
              })}
            </time>
          </Tooltip>
        )}
        {statsRefreshing && !statsLoading && <span role="status">{t("common.refreshing")}</span>}
      </div>
      {statsFailed && (
        <div className="dashboard-refresh-error" role="alert">
          <Text size="2">{t("dashboard.loadFailed")}</Text>
          <Button size="1" variant="soft" color="gray" onClick={() => void loadStats()}>
            {t("errorBoundary.retry")}
          </Button>
        </div>
      )}

      <Reveal visible={mounted}>
        <div className="dashboard-stats" aria-busy={statsLoading}>
          <StatCard
            title={t("dashboard.runningServers")}
            value={
              hasStats ? (
                <>
                  {stats.onlineServers}
                  <Text size="2" color="gray" ml="2">
                    / {stats.totalServers}
                  </Text>
                </>
              ) : (
                "—"
              )
            }
            subtitle={t("server.totalServers") + ` ${hasStats ? stats.totalServers : "—"}`}
            color="blue"
            icon={<Icon icon="lucide:server" />}
            loading={statsLoading}
          />
          <StatCard
            title={t("dashboard.onlineProxies")}
            value={
              hasStats ? (
                <>
                  {stats.runningProxies}
                  <Text size="2" color="gray" ml="2">
                    / {stats.totalProxies}
                  </Text>
                </>
              ) : (
                "—"
              )
            }
            subtitle={t("proxy.tunnelState")}
            color="green"
            icon={<Icon icon="lucide:network" />}
            loading={statsLoading}
          />
          <StatCard
            title={t("dashboard.maxLatency")}
            value={
              hasStats && stats.maxLatency > 0 ? (
                <>
                  {stats.maxLatency}
                  <Text size="2" color="gray" ml="2">
                    ms
                  </Text>
                </>
              ) : (
                "—"
              )
            }
            subtitle={t("server.latency")}
            color="amber"
            icon={<Icon icon="lucide:activity" />}
            loading={statsLoading}
          />
          <StatCard
            title={t("dashboard.visitors")}
            value={
              hasStats ? (
                <>
                  {stats.visitorsEnabled}
                  <Text size="2" color="gray" ml="2">
                    / {stats.visitorsTotal}
                  </Text>
                </>
              ) : (
                "—"
              )
            }
            subtitle={t("visitor.localAddress")}
            color="purple"
            icon={<Icon icon="lucide:door-open" />}
            loading={statsLoading}
          />
          <StatCard
            title={t("dashboard.trafficToday")}
            value={
              hasStats && stats.trafficServers > 0
                ? formatBytes(stats.trafficIn + stats.trafficOut)
                : "—"
            }
            subtitle={
              stats.trafficServers > 0
                ? t("dashboard.trafficSplit", {
                    in: formatBytes(stats.trafficIn),
                    out: formatBytes(stats.trafficOut),
                  })
                : t("dashboard.trafficNoDashboard")
            }
            color="cyan"
            icon={<Icon icon="lucide:arrow-down-up" />}
            loading={statsLoading}
          />
        </div>
      </Reveal>

      <Reveal visible={mounted} delay={0.04}>
        <Card size="3" className="dashboard-panel">
          {topologyFailed && (
            <div className="dashboard-refresh-error" role="alert">
              <Text size="2">{t("dashboard.topologyLoadFailed")}</Text>
              <Button size="1" variant="soft" color="gray" onClick={() => void loadTopology()}>
                {t("errorBoundary.retry")}
              </Button>
            </div>
          )}
          {topologyLoading ? (
            <Flex direction="column" gap="4">
              <Heading size="3">{t("dashboard.topology")}</Heading>
              <Text role="status" size="2" color="gray">
                {t("common.loading")}
              </Text>
              <Skeleton width="100%" height="480px" />
            </Flex>
          ) : (
            <Suspense fallback={<Skeleton width="100%" height="480px" />}>
              <TopologyChart topology={topology} />
            </Suspense>
          )}
        </Card>
      </Reveal>

      <div className="dashboard-secondary">
        <Card size="3" className="dashboard-panel">
          <ProxyDistribution counts={stats.proxyTypeCounts} />
        </Card>
        <Card size="3" className="dashboard-panel">
          <Heading size="3">{t("dashboard.runtimeSummary")}</Heading>
          <div className="dashboard-runtime">
            <div>
              <Text size="2" color="gray">
                {t("dashboard.systemUptime")}
              </Text>
              <Text as="div" size="4" weight="medium" mt="2">
                {hasStats ? uptime : "—"}
              </Text>
            </div>
            <div>
              <Text size="2" color="gray">
                {t("proxy.filterDisabled")}
              </Text>
              <Text as="div" size="4" weight="medium" mt="2">
                {hasStats ? stats.stoppedProxies : "—"}
              </Text>
            </div>
          </div>
          <Text as="p" size="2" color="gray">
            {t("dashboard.summaryHint")}
          </Text>
          {stats.trafficServers > 0 && (
            <Text as="p" size="1" color="gray" mt="2">
              {t("dashboard.trafficCoverage", { count: stats.trafficServers })}
            </Text>
          )}
          <div className="dashboard-summary-actions" style={{ marginTop: 18 }}>
            <Button asChild size="2" variant="soft" color="gray">
              <Link to="/logs">
                <Icon icon="lucide:scroll-text" width="15" height="15" />
                {t("nav.logs")}
              </Link>
            </Button>
            <Button asChild size="2" variant="soft">
              <Link to="/proxies/new">
                <Icon icon="lucide:plus" width="15" height="15" />
                {t("proxy.addProxy")}
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    </Flex>
  );
}
