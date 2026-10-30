import { useEffect, useState } from "react";
import { Button, Dialog, Flex, Spinner, Table, Text } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet, getErrorMessage } from "../lib/api";
import { formatBytes } from "../lib/format";

/** Fixed series colors, validated for light and dark surfaces (dataviz palette check). */
const IN_COLOR = "#0090ff";
const OUT_COLOR = "#ef5f00";

interface TrafficHistory {
  trafficIn: number[];
  trafficOut: number[];
}

interface TrafficDialogProps {
  proxyId: string;
  proxyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Last 7 days of a proxy's traffic from its frps dashboard, as grouped bars plus a table. */
export function TrafficDialog({ proxyId, proxyName, open, onOpenChange }: TrafficDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="640px">
        <Dialog.Title>{t("traffic.title", { name: proxyName })}</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          {t("traffic.description")}
        </Dialog.Description>
        {/* Mounted per opening, so every opening loads fresh data. */}
        {open && <TrafficBody proxyId={proxyId} />}
        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              {t("common.close")}
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function TrafficBody({ proxyId }: { proxyId: string }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<TrafficHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<TrafficHistory>(`/api/proxies/${proxyId}/traffic`)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(getErrorMessage(err) ?? "error"));
    return () => {
      cancelled = true;
    };
  }, [proxyId]);

  // frps lists the days newest first (index 0 = today); the chart runs oldest to newest.
  const rows = data
    ? data.trafficIn
        .map((_, i) => {
          const day = new Date();
          day.setDate(day.getDate() - i);
          return {
            day: day.toLocaleDateString(i18n.language, { month: "numeric", day: "numeric" }),
            in: data.trafficIn[i] ?? 0,
            out: data.trafficOut[i] ?? 0,
          };
        })
        .reverse()
    : [];

  return (
    <>
        {error ? (
          <Text as="p" color="red" size="2" mt="4">
            {error}
          </Text>
        ) : !data ? (
          <Flex justify="center" py="6">
            <Spinner />
          </Flex>
        ) : (
          <Flex direction="column" gap="4" mt="4">
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barGap={2}>
                  <CartesianGrid vertical={false} stroke="var(--gray-4)" />
                  <XAxis dataKey="day" tick={{ fill: "var(--gray-11)", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis
                    tickFormatter={(v: number) => formatBytes(v)}
                    tick={{ fill: "var(--gray-11)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                    width={72}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--gray-a3)" }}
                    formatter={(v, name) => [formatBytes(Number(v ?? 0)), String(name)]}
                    contentStyle={{ background: "var(--color-panel-solid)", border: "1px solid var(--gray-6)", borderRadius: 8 }}
                    labelStyle={{ color: "var(--gray-12)" }}
                    itemStyle={{ color: "var(--gray-12)" }}
                  />
                  <Legend wrapperStyle={{ color: "var(--gray-11)", fontSize: 12 }} />
                  <Bar dataKey="in" name={t("traffic.in")} fill={IN_COLOR} radius={[4, 4, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="out" name={t("traffic.out")} fill={OUT_COLOR} radius={[4, 4, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table.Root size="1" variant="surface">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>{t("traffic.day")}</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell align="right">{t("traffic.in")}</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell align="right">{t("traffic.out")}</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {[...rows].reverse().map((r) => (
                  <Table.Row key={r.day}>
                    <Table.Cell>{r.day}</Table.Cell>
                    <Table.Cell align="right">{formatBytes(r.in)}</Table.Cell>
                    <Table.Cell align="right">{formatBytes(r.out)}</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Flex>
        )}
    </>
  );
}
