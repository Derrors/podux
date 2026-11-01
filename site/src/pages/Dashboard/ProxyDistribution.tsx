import { Flex, Text, Tooltip } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";

/** One magnitude series, not a categorical palette. The table is the chart's readable twin. */
export function ProxyDistribution({ counts }: { counts: Record<string, number> }) {
  const { t } = useTranslation();
  const rows = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  const max = Math.max(...rows.map(([, count]) => count), 1);
  return (
    <Flex direction="column" gap="4" style={{ minHeight: 350 }}>
      <Text size="3" weight="bold">
        {t("dashboard.proxyTypeDistribution")}
      </Text>
      {rows.length === 0 ? (
        <Flex direction="column" gap="2" align="center" justify="center" flexGrow="1">
          <Text color="gray">{t("dashboard.noProxies")}</Text>
          <Text size="2" color="gray">
            {t("dashboard.noProxiesDesc")}
          </Text>
        </Flex>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", color: "var(--gray-12)" }}>
          <caption className="sr-only">{t("dashboard.proxyTypeDistribution")}</caption>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "left" }}>
                {t("common.type")}
              </th>
              <th scope="col" style={{ textAlign: "right" }}>
                {t("dashboard.totalProxies")}
              </th>
              <th scope="col" className="sr-only">
                {t("dashboard.distributionShare")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([type, count]) => (
              <tr key={type}>
                <th
                  scope="row"
                  style={{ textAlign: "left", padding: "12px 8px 12px 0", fontWeight: 500 }}
                >
                  {type.toUpperCase()}
                </th>
                <td style={{ textAlign: "right", width: "60%" }}>
                  <Tooltip
                    content={`${type.toUpperCase()} · ${count} · ${((count / total) * 100).toFixed(1)}%`}
                  >
                    <span
                      tabIndex={0}
                      style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 28 }}
                    >
                      <span aria-hidden="true" style={{ flex: 1, display: "flex" }}>
                        <span
                          style={{
                            width: `${(count / max) * 100}%`,
                            height: 12,
                            borderRadius: "0 4px 4px 0",
                            background: "var(--indigo-9)",
                            border: "1px solid transparent",
                          }}
                        />
                      </span>
                      <span style={{ minWidth: "3ch", fontVariantNumeric: "tabular-nums" }}>
                        {count}
                      </span>
                    </span>
                  </Tooltip>
                </td>
                <td className="sr-only">{((count / total) * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Flex>
  );
}
