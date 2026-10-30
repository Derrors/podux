import { Icon } from "@iconify/react/offline";
import { Box, Button, Flex, Separator, Text, TextField } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { FormItem } from "../../../components/FormItem";
import { SectionHeading } from "../../../components/SectionHeading";
import type { ServerFormData } from "./useServerForm";

/** Optional frps dashboard login, used for traffic stats and probe targets. */
export function DashboardSection({ dashboard, testing, onChange, onTest }: {
  dashboard: ServerFormData["dashboard"];
  testing: boolean;
  onChange: (field: keyof ServerFormData["dashboard"], value: string) => void;
  onTest: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Separator size="4" />
      <section>
        <SectionHeading id="section-dashboard" title={t("server.dashboard")} icon="lucide:chart-column" />
        <Flex direction="column" gap="4">
          <Text size="1" color="gray" as="p">
            {t("server.dashboardDesc")}
          </Text>
          <FormItem label={t("server.dashboardUrl")}>
            <TextField.Root
              size="2"
              placeholder="http://frps.example.com:7500"
              value={dashboard.url}
              onChange={(e) => onChange("url", e.target.value)}
            />
          </FormItem>
          <Flex gap="3" wrap="wrap">
            <Box className="min-w-[200px] flex-1">
              <FormItem label={t("server.dashboardUser")}>
                <TextField.Root size="2" autoComplete="off" value={dashboard.user} onChange={(e) => onChange("user", e.target.value)} />
              </FormItem>
            </Box>
            <Box className="min-w-[200px] flex-1">
              <FormItem label={t("server.dashboardPassword")}>
                <TextField.Root
                  size="2"
                  type="password"
                  autoComplete="new-password"
                  value={dashboard.password}
                  onChange={(e) => onChange("password", e.target.value)}
                />
              </FormItem>
            </Box>
          </Flex>
          <Flex>
            <Button type="button" variant="soft" disabled={!dashboard.url.trim() || testing} onClick={onTest}>
              <Icon icon={testing ? "lucide:loader-2" : "lucide:plug-zap"} className={testing ? "animate-spin" : ""} width="14" height="14" />
              {t("server.dashboardTest")}
            </Button>
          </Flex>
        </Flex>
      </section>
    </>
  );
}
