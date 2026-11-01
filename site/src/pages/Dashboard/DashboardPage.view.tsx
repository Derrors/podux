import { Box, Button, Card, Flex, Text, Tooltip as HintTooltip } from "@radix-ui/themes";
import type { useDashboard } from "./useDashboard";
import { ProxyDistribution } from "./ProxyDistribution";
import { Icon } from "@iconify/react/offline";
import { PageHeader } from "../../components/PageHeader";
import { lazy, Suspense, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AnimateNumber } from "../../components/AnimateNumber";
import { useTranslation } from "react-i18next";
import { StatCard } from "../../components/StatCard";
import { formatBytes } from "../../lib/format";

const TopologyChart = lazy(() =>
  import("./TopologyChart").then((m) => ({ default: m.TopologyChart }))
);

type DashboardViewProps = ReturnType<typeof useDashboard>;

// Helper function to format uptime
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

export function DashboardView({
  stats,
  topology,
  statsLoading,
  topologyLoading,
  statsFailed,
  topologyFailed,
  loadStats,
  loadTopology,
}: DashboardViewProps) {
  const { t } = useTranslation();
  // "4.6 GB" -> number and unit, styled like the other cards' "195 ms".
  const [trafficValue, trafficUnit] = formatBytes(stats.trafficIn + stats.trafficOut).split(" ");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Flex direction="column" gap="6">
      {/* Header */}
      <PageHeader
        title={t("dashboard.title")}
        description={t("dashboard.overview")}
        visible={mounted}
      />

      {statsLoading && (
        <Text role="status" color="gray">
          {t("common.loading")}
        </Text>
      )}
      {statsFailed && (
        <Flex role="alert" gap="3" align="center" wrap="wrap">
          <Text color="gray">{t("dashboard.loadFailed")}</Text>
          <Button variant="soft" onClick={() => void loadStats()}>
            {t("errorBoundary.retry")}
          </Button>
        </Flex>
      )}
      {/* Stats Cards Row 1 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={mounted ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
        >
          <StatCard
            title={t("dashboard.runningProxies")}
            value={
              <>
                <AnimateNumber value={stats.runningProxies} decimalPlaces={0} />
                <Text size="2" color="gray" weight="regular" ml="2">
                  / {stats.totalProxies}
                </Text>
              </>
            }
            color="green"
            icon={<Icon icon="lucide:network" color="var(--green-11)" width="32" height="32" />}
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={mounted ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
        >
          <StatCard
            title={t("dashboard.onlineServers")}
            value={
              <>
                <AnimateNumber value={stats.onlineServers} decimalPlaces={0} />
                <Text size="2" color="gray" weight="regular" ml="2">
                  / {stats.totalServers}
                </Text>
              </>
            }
            color="blue"
            icon={<Icon icon="lucide:server" color="var(--blue-11)" width="32" height="32" />}
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={mounted ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.3, ease: "easeOut" }}
        >
          <StatCard
            title={t("dashboard.maxLatency")}
            value={
              <>
                <AnimateNumber value={stats.maxLatency} decimalPlaces={0} />
                <Text size="2" color="gray" weight="regular" ml="2">
                  ms
                </Text>
              </>
            }
            color="orange"
            icon={<Icon icon="lucide:activity" color="var(--orange-11)" width="32" height="32" />}
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={mounted ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.4, ease: "easeOut" }}
        >
          <StatCard
            title={t("dashboard.visitors")}
            value={
              <>
                <AnimateNumber value={stats.visitorsEnabled} decimalPlaces={0} />
                <Text size="2" color="gray" weight="regular" ml="2">
                  / {stats.visitorsTotal}
                </Text>
              </>
            }
            color="gray"
            icon={<Icon icon="lucide:door-open" color="var(--gray-11)" width="32" height="32" />}
          />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={mounted ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.5, ease: "easeOut" }}
        >
          <StatCard
            title={t("dashboard.trafficToday")}
            value={
              stats.trafficServers > 0 ? (
                // Total like the other values; the in/out split doesn't fit a card, so it's on hover.
                <HintTooltip
                  content={t("dashboard.trafficSplit", {
                    in: formatBytes(stats.trafficIn),
                    out: formatBytes(stats.trafficOut),
                  })}
                >
                  <span>
                    {trafficValue}
                    <Text size="2" color="gray" weight="regular" ml="2">
                      {trafficUnit}
                    </Text>
                  </span>
                </HintTooltip>
              ) : (
                // Not configured: a dash at the height of the other values, the hint on hover.
                <HintTooltip content={t("dashboard.trafficNoDashboard")}>
                  <Text color="gray" aria-label={t("dashboard.trafficNoDashboard")}>
                    —
                  </Text>
                </HintTooltip>
              )
            }
            color="blue"
            icon={
              <Icon icon="lucide:arrow-down-up" color="var(--blue-11)" width="32" height="32" />
            }
          />
        </motion.div>
      </div>

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={mounted ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.5, delay: 0.4, ease: "easeOut" }}
      >
        <Flex direction="column" gap="3">
          <Text size="2" weight="bold" color="gray">
            {t("dashboard.quickActions")}
          </Text>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                {
                  to: "/servers",
                  icon: "lucide:server",
                  color: "var(--blue-9)",
                  bg: "var(--blue-3)",
                  titleKey: "nav.servers",
                  descKey: "dashboard.qaServersDesc",
                },
                {
                  to: "/proxies",
                  icon: "lucide:network",
                  color: "var(--green-9)",
                  bg: "var(--green-3)",
                  titleKey: "nav.proxies",
                  descKey: "dashboard.qaProxiesDesc",
                },
                {
                  to: "/import",
                  icon: "lucide:file-input",
                  color: "var(--orange-9)",
                  bg: "var(--orange-3)",
                  titleKey: "nav.import",
                  descKey: "dashboard.qaImportDesc",
                },
                {
                  to: "/settings",
                  icon: "lucide:settings-2",
                  color: "var(--purple-9)",
                  bg: "var(--purple-3)",
                  titleKey: "nav.settings",
                  descKey: "dashboard.qaSettingsDesc",
                },
              ] as const
            ).map(({ to, icon, color, bg, titleKey, descKey }) => (
              <Link key={to} to={to} style={{ textDecoration: "none" }}>
                <Card size="2" style={{ cursor: "pointer", height: "100%" }}>
                  <Flex direction="column" gap="2">
                    <Box
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: "var(--radius-3)",
                        background: bg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon icon={icon} color={color} width="18" height="18" />
                    </Box>
                    <Flex direction="column" gap="1" style={{ flex: 1 }}>
                      <Text size="2" weight="bold">
                        {t(titleKey)}
                      </Text>
                      <Text size="1" color="gray">
                        {t(descKey)}
                      </Text>
                    </Flex>
                    <Flex justify="end">
                      <Icon
                        icon="lucide:arrow-right"
                        color="var(--gray-8)"
                        width="14"
                        height="14"
                      />
                    </Flex>
                  </Flex>
                </Card>
              </Link>
            ))}
          </div>
        </Flex>
      </motion.div>

      {/* Proxy Type Distribution & System Uptime */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Proxy Type Pie Chart */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={mounted ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.5, ease: "easeOut" }}
        >
          <Card size="3">
            <ProxyDistribution counts={stats.proxyTypeCounts} />
          </Card>
        </motion.div>

        {/* System Uptime */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={mounted ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.5, delay: 0.6, ease: "easeOut" }}
        >
          <Card size="3">
            <Flex
              direction="column"
              gap="3"
              align="center"
              justify="center"
              className="h-full min-h-[350px]"
            >
              <Icon icon="lucide:clock" color="var(--indigo-9)" width="56" height="56" />
              <Flex direction="column" gap="1" align="center">
                <Text size="3" weight="medium" color="gray">
                  {t("dashboard.systemUptime")}
                </Text>
                <Text size="6" weight="bold" style={{ color: "var(--indigo-11)" }}>
                  {formatUptime(stats.uptimeSeconds)}
                </Text>
                <Text size="2" color="gray">
                  {t("dashboard.runningSinceStartup")}
                </Text>
              </Flex>
            </Flex>
          </Card>
        </motion.div>
      </div>

      {/* Network Topology */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={mounted ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.5, delay: 0.7, ease: "easeOut" }}
      >
        <Card size="3">
          <Flex direction="column" gap="3">
            <Flex direction="column" gap="1">
              <Text size="3" weight="bold">
                {t("dashboard.topology")}
              </Text>
              <Text size="2" color="gray">
                {t("dashboard.topologyDesc")}
              </Text>
            </Flex>
            {topologyFailed && (
              <Flex role="alert" gap="3" align="center" wrap="wrap">
                <Text color="gray">{t("dashboard.topologyLoadFailed")}</Text>
                <Button variant="soft" onClick={() => void loadTopology()}>
                  {t("errorBoundary.retry")}
                </Button>
              </Flex>
            )}
            <Box>
              {topologyLoading ? (
                <Text role="status" color="gray">
                  {t("common.loading")}
                </Text>
              ) : (
                <Suspense
                  fallback={
                    <Text role="status" color="gray">
                      {t("common.loading")}
                    </Text>
                  }
                >
                  <TopologyChart topology={topology} />
                </Suspense>
              )}
            </Box>
          </Flex>
        </Card>
      </motion.div>
    </Flex>
  );
}
