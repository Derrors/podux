import { useNavigate } from "react-router-dom";
import { Button, Card, Flex } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { PageHeader } from "../../components/PageHeader";
import { ServerLogViewer } from "../../components/ServerLogViewer";
import { useDelayedMount } from "../../hooks/useDelayedMount";

/** The whole frpc log: every server's lines, named, plus lines that belong to no server. */
export function AllLogsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mounted = useDelayedMount();

  return (
    <Flex direction="column" gap="5">
      <PageHeader
        title={t("server.allLogs")}
        description={t("server.allLogsDesc")}
        visible={mounted}
        extra={
          <Button variant="soft" onClick={() => navigate("/servers")}>
            <Icon icon="lucide:arrow-left" width="16" height="16" />
            {t("server.backToServers")}
          </Button>
        }
      />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={mounted ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
      >
        <Card size="3">
          <ServerLogViewer serverId="all" height="calc(100vh - 280px)" showHeading={false} />
        </Card>
      </motion.div>
    </Flex>
  );
}
