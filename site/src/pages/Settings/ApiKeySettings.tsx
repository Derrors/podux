import { useCallback, useEffect, useState } from "react";
import { Badge, Box, Button, Callout, Code, Flex, Heading, Select, Separator, Table, Text, TextField } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import i18n from "../../i18n";
import { apiFetch, apiGet, apiPost } from "../../lib/api";
import { copyToClipboard } from "../../lib/clipboard";
import { formatTimeAgo } from "../../lib/format";
import { notifyError } from "../../lib/notify";
import { FormItem } from "../../components/FormItem";
import { ConfirmDeleteDialog } from "../../components/ConfirmDeleteDialog";

/** Mirrors apikey.Key in internal/application/apikey/service.go. */
interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scope: Scope;
  lastUsedAt: string;
  created: string;
}

type Scope = "read" | "write";

const BASE = "/api/api-keys";

/** Routes that accept an API key, by the scope they need; mirrors requireScope in internal/interfaces/http. */
const ROUTES: { scope: Scope; method: string; path: string }[] = [
  { scope: "read", method: "GET", path: "/api/metrics" },
  { scope: "read", method: "GET", path: "/api/dashboard/stats" },
  { scope: "read", method: "GET", path: "/api/proxies/status" },
  { scope: "write", method: "POST", path: "/api/frpc/launch" },
  { scope: "write", method: "POST", path: "/api/frpc/terminate" },
  { scope: "write", method: "POST", path: "/api/frpc/reload" },
  { scope: "write", method: "POST", path: "/api/proxies/batch" },
];

/** PocketBase dates ("2006-01-02 15:04:05.000Z") into a Date. */
const parseDate = (s: string) => new Date(s.replace(" ", "T"));

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation();
  return (
    <Button
      size="1"
      variant="soft"
      onClick={() =>
        copyToClipboard(text).then(
          () => toast.success(t("common.copied")),
          () => toast.error(t("apiKeys.copyFailed"))
        )
      }
    >
      <Icon icon="lucide:copy" width="14" height="14" />
      {label}
    </Button>
  );
}

export function ApiKeySettings() {
  const { t, i18n: i18nInstance } = useTranslation();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>("read");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null);

  const load = useCallback(async () => {
    try {
      setKeys(await apiGet<ApiKey[]>(BASE));
    } catch (err) {
      // i18n singleton, not t: t changes per language and would reload the list.
      notifyError(i18n.t("apiKeys.loadFailed"), err);
      setKeys([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const out = await apiPost<{ key: ApiKey; token: string }>(BASE, { name: name.trim(), scope });
      setCreated({ name: out.key.name, token: out.token });
      setName("");
      await load();
    } catch (err) {
      notifyError(t("apiKeys.createFailed"), err);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (key: ApiKey) => {
    try {
      await apiFetch(`${BASE}/${key.id}`, { method: "DELETE" });
      toast.success(t("apiKeys.deleted"));
      await load();
    } catch (err) {
      notifyError(t("apiKeys.deleteFailed"), err);
    }
  };

  const scrapeConfig = `scrape_configs:
  - job_name: podux
    metrics_path: /api/metrics
    scheme: ${window.location.protocol.replace(":", "")}
    authorization:
      credentials: <API Key>
    static_configs:
      - targets: ["${window.location.host}"]`;

  return (
    <Flex direction="column" gap="4">
      <Box>
        <Heading size="4" mb="1">
          {t("apiKeys.title")}
        </Heading>
        <Text size="2" color="gray">
          {t("apiKeys.description")}
        </Text>
      </Box>

      <Separator size="4" />

      <Flex gap="3" wrap="wrap" align="end">
        <FormItem label={t("common.name")}>
          <TextField.Root
            placeholder={t("apiKeys.namePlaceholder")}
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && !creating && void create()}
            style={{ minWidth: 220 }}
          />
        </FormItem>
        <FormItem label={t("apiKeys.scope")}>
          <Select.Root value={scope} onValueChange={(v) => setScope(v as Scope)}>
            <Select.Trigger style={{ minWidth: 140 }} />
            <Select.Content>
              <Select.Item value="read">{t("apiKeys.scopeRead")}</Select.Item>
              <Select.Item value="write">{t("apiKeys.scopeWrite")}</Select.Item>
            </Select.Content>
          </Select.Root>
        </FormItem>
        <Button onClick={create} disabled={creating || !name.trim()}>
          <Icon
            icon={creating ? "lucide:loader-2" : "lucide:plus"}
            className={creating ? "animate-spin" : ""}
            width="16"
            height="16"
          />
          {t("apiKeys.create")}
        </Button>
      </Flex>

      {created && (
        <Callout.Root color="green" size="1">
          <Callout.Icon>
            <Icon icon="lucide:key-round" width="14" height="14" />
          </Callout.Icon>
          <Flex direction="column" gap="2" style={{ minWidth: 0 }}>
            <Text size="2" weight="medium">
              {t("apiKeys.createdTitle", { name: created.name })}
            </Text>
            <Text size="1">{t("apiKeys.createdOnce")}</Text>
            <Code size="2" variant="ghost" className="break-all" style={{ userSelect: "all" }}>
              {created.token}
            </Code>
            <Flex gap="2">
              <CopyButton text={created.token} label={t("apiKeys.copyKey")} />
              <Button size="1" variant="ghost" color="gray" onClick={() => setCreated(null)}>
                {t("apiKeys.dismiss")}
              </Button>
            </Flex>
          </Flex>
        </Callout.Root>
      )}

      {keys === null ? (
        <Flex justify="center" py="6">
          <Icon icon="lucide:loader-circle" width="24" height="24" className="animate-spin" />
        </Flex>
      ) : keys.length === 0 ? (
        <Text size="2" color="gray">
          {t("apiKeys.empty")}
        </Text>
      ) : (
        <div className="overflow-x-auto">
          <Table.Root variant="surface" size="1" className="whitespace-nowrap">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>{t("common.name")}</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>{t("apiKeys.key")}</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>{t("apiKeys.scope")}</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>{t("common.created")}</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>{t("apiKeys.lastUsed")}</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>{t("common.actions")}</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {keys.map((k) => (
                <Table.Row key={k.id}>
                  <Table.Cell>
                    <Text size="2" weight="medium">
                      {k.name}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="2" className="font-mono" color="gray">
                      {k.prefix}…
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge size="1" variant="soft" color={k.scope === "write" ? "orange" : "gray"}>
                      {k.scope === "write" ? t("apiKeys.scopeWrite") : t("apiKeys.scopeRead")}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>{parseDate(k.created).toLocaleString()}</Table.Cell>
                  <Table.Cell>
                    {k.lastUsedAt
                      ? formatTimeAgo(parseDate(k.lastUsedAt), i18nInstance.language, t)
                      : t("time.never")}
                  </Table.Cell>
                  <Table.Cell>
                    <Button size="1" variant="soft" color="red" onClick={() => setDeleteKey(k)}>
                      <Icon icon="lucide:trash-2" width="14" height="14" />
                      {t("common.delete")}
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </div>
      )}

      <Separator size="4" />

      <Box>
        <Text size="3" weight="bold" mb="1" style={{ display: "block" }}>
          {t("apiKeys.usage")}
        </Text>
        <Text size="2" color="gray" as="p" mb="3">
          {t("apiKeys.usageDesc")}
        </Text>
        <Box className="overflow-x-auto rounded-lg bg-[var(--gray-a3)] p-3">
          <pre className="m-0 font-mono text-xs leading-5">
            {`Authorization: Bearer <API Key>\n\n`}
            {ROUTES.map((r) => `${r.method.padEnd(5)}${r.path.padEnd(24)}${r.scope === "read" ? t("apiKeys.scopeRead") : t("apiKeys.scopeWrite")}`).join("\n")}
          </pre>
        </Box>
        <Text size="1" color="gray" as="p" mt="2">
          {t("apiKeys.otherRoutes")}
        </Text>
      </Box>

      <Box>
        <Flex justify="between" align="center" gap="2" mb="1">
          <Text size="3" weight="bold">
            {t("apiKeys.prometheus")}
          </Text>
          <CopyButton text={scrapeConfig} label={t("apiKeys.copyConfig")} />
        </Flex>
        <Text size="2" color="gray" as="p" mb="3">
          {t("apiKeys.prometheusDesc")}
        </Text>
        <Box className="overflow-x-auto rounded-lg bg-[var(--gray-a3)] p-3">
          <pre className="m-0 font-mono text-xs leading-5">{scrapeConfig}</pre>
        </Box>
      </Box>

      <ConfirmDeleteDialog
        open={deleteKey !== null}
        title={t("apiKeys.deleteTitle")}
        description={t("apiKeys.deleteConfirm", { name: deleteKey?.name ?? "" })}
        onClose={() => setDeleteKey(null)}
        onConfirm={() => {
          if (deleteKey) void remove(deleteKey);
          setDeleteKey(null);
        }}
      />
    </Flex>
  );
}
