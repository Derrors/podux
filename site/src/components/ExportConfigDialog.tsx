import { useState } from "react";
import { Button, Callout, Checkbox, Dialog, Flex, Text } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { apiFetch } from "../lib/api";
import { notifyError } from "../lib/notify";

interface ExportConfigDialogProps {
  serverId: string;
  serverName: string;
}

/** Button and dialog that download a server's configuration as frpc.toml. */
export function ExportConfigDialog({ serverId, serverName }: ExportConfigDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const query = new URLSearchParams({ id: serverId, ...(includeSecrets ? { secrets: "1" } : {}) });
      const response = await apiFetch(`/api/frpc/export?${query}`);
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `frpc-${serverName.replace(/[^\w.-]+/g, "_") || serverId}.toml`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("export.success"));
      setOpen(false);
    } catch (err) {
      notifyError(t("export.failed"), err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <Button variant="soft" color="gray">
          <Icon icon="lucide:file-down" width="16" height="16" />
          {t("export.button")}
        </Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>{t("export.title")}</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          {t("export.description")}
        </Dialog.Description>

        <Flex direction="column" gap="3" mt="4">
          <Text as="label" size="2">
            <Flex gap="2" align="center">
              <Checkbox checked={includeSecrets} onCheckedChange={(v) => setIncludeSecrets(v === true)} />
              {t("export.includeSecrets")}
            </Flex>
          </Text>
          {includeSecrets && (
            <Callout.Root color="orange" size="1">
              <Callout.Icon>
                <Icon icon="lucide:triangle-alert" width="14" height="14" />
              </Callout.Icon>
              <Callout.Text>{t("export.secretsWarning")}</Callout.Text>
            </Callout.Root>
          )}
        </Flex>

        <Flex gap="3" mt="5" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              {t("common.cancel")}
            </Button>
          </Dialog.Close>
          <Button onClick={download} disabled={downloading}>
            <Icon icon={downloading ? "lucide:loader-2" : "lucide:download"} className={downloading ? "animate-spin" : ""} width="16" height="16" />
            {t("export.download")}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
