import { useEffect, useState, type ReactNode } from "react";
import { Badge, Box, Button, Callout, Flex, Heading, Select, Separator, Switch, Text, TextField } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import i18n from "../../i18n";
import { apiGet, apiPost, apiPut } from "../../lib/api";
import { notifyError } from "../../lib/notify";
import { FormItem } from "../../components/FormItem";

/** Mirrors notify.Settings in internal/application/notify/settings.go. */
interface NotificationSettingsData {
  enabled: boolean;
  events: {
    serverUnreachable: boolean;
    highLatency: boolean;
    proxyDown: boolean;
    frpcExited: boolean;
    proxyUnreachable: boolean;
    proxyExpired: boolean;
    recovered: boolean;
  };
  latencyThresholdMs: number;
  webhook: { enabled: boolean; url: string; format: "generic" | "wecom" | "dingtalk" | "feishu" };
  telegram: { enabled: boolean; botToken: string; chatId: string; apiBase: string };
  bark: { enabled: boolean; serverUrl: string; deviceKey: string };
  email: { enabled: boolean; to: string };
}

interface TestResult {
  channel: string;
  ok: boolean;
  error?: string;
}

type Channel = "webhook" | "telegram" | "bark" | "email";

const EVENTS = [
  "serverUnreachable",
  "highLatency",
  "proxyDown",
  "proxyUnreachable",
  "frpcExited",
  "proxyExpired",
  "recovered",
] as const;

function SwitchRow({ label, description, checked, onChange }: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Flex justify="between" align="center" gap="3">
      <Box>
        <Text size="2" weight="medium">{label}</Text>
        {description && <Text as="p" size="1" color="gray">{description}</Text>}
      </Box>
      <Switch checked={checked} onCheckedChange={onChange} />
    </Flex>
  );
}

function ChannelBlock({ title, icon, enabled, onToggle, children }: {
  title: string;
  icon: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Box className="rounded-lg border border-[var(--gray-5)] p-3">
      <Flex justify="between" align="center">
        <Flex align="center" gap="2">
          <Icon icon={icon} width="18" height="18" />
          <Text size="2" weight="bold">{title}</Text>
        </Flex>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </Flex>
      {enabled && (
        <Flex direction="column" gap="3" mt="3">
          {children}
        </Flex>
      )}
    </Box>
  );
}

export function NotificationSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<NotificationSettingsData | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<TestResult[] | null>(null);

  useEffect(() => {
    apiGet<NotificationSettingsData>("/api/notifications")
      .then(setSettings)
      // i18n singleton, not t: t changes per language and would reload and reset the form.
      .catch((err) => notifyError(i18n.t("notifications.loadFailed"), err));
  }, []);

  if (!settings) {
    return (
      <Flex justify="center" align="center" style={{ minHeight: "400px" }}>
        <Icon icon="lucide:loader-circle" width="32" height="32" className="animate-spin" />
      </Flex>
    );
  }

  const update = (patch: Partial<NotificationSettingsData>) => setSettings({ ...settings, ...patch });
  const updateChannel = <C extends Channel>(channel: C, patch: Partial<NotificationSettingsData[C]>) =>
    setSettings({ ...settings, [channel]: { ...settings[channel], ...patch } });

  const save = async () => {
    setSaving(true);
    try {
      setSettings(await apiPut<NotificationSettingsData>("/api/notifications", settings));
      toast.success(t("settings.saveSuccess"));
    } catch (err) {
      notifyError(t("settings.saveFailed"), err);
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setResults(null);
    try {
      const out = await apiPost<TestResult[]>("/api/notifications/test", settings);
      setResults(out);
      if (out.length === 0) toast.info(t("notifications.noChannels"));
    } catch (err) {
      notifyError(t("notifications.testFailed"), err);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Flex direction="column" gap="4">
      <Box>
        <Heading size="4" mb="1">
          {t("notifications.title")}
        </Heading>
        <Text size="2" color="gray">
          {t("notifications.description")}
        </Text>
      </Box>

      <Separator size="4" />

      <SwitchRow
        label={t("notifications.enable")}
        description={t("notifications.enableDesc")}
        checked={settings.enabled}
        onChange={(v) => update({ enabled: v })}
      />

      <Separator size="4" />

      <Box>
        <Text size="3" weight="bold" mb="3" style={{ display: "block" }}>
          {t("notifications.events")}
        </Text>
        <Flex direction="column" gap="3">
          {EVENTS.map((event) => (
            <SwitchRow
              key={event}
              label={t(`notifications.event.${event}`)}
              description={t(`notifications.event.${event}Desc`)}
              checked={settings.events[event]}
              onChange={(v) => update({ events: { ...settings.events, [event]: v } })}
            />
          ))}
          <FormItem label={t("notifications.latencyThreshold")}>
            <Flex align="center" gap="2">
              <TextField.Root
                type="number"
                min="0"
                value={String(settings.latencyThresholdMs)}
                onChange={(e) => update({ latencyThresholdMs: Math.max(0, parseInt(e.target.value) || 0) })}
                style={{ flex: 1 }}
              />
              <Text size="2" color="gray">ms</Text>
            </Flex>
            <Text size="1" color="gray" mt="1" as="p">
              {t("notifications.latencyThresholdDesc")}
            </Text>
          </FormItem>
        </Flex>
      </Box>

      <Separator size="4" />

      <Box>
        <Text size="3" weight="bold" mb="3" style={{ display: "block" }}>
          {t("notifications.channels")}
        </Text>
        <Flex direction="column" gap="3">
          <ChannelBlock
            title="Webhook"
            icon="lucide:webhook"
            enabled={settings.webhook.enabled}
            onToggle={(v) => updateChannel("webhook", { enabled: v })}
          >
            <FormItem label={t("notifications.webhookFormat")}>
              <Select.Root
                value={settings.webhook.format || "generic"}
                onValueChange={(v) => updateChannel("webhook", { format: v as NotificationSettingsData["webhook"]["format"] })}
              >
                <Select.Trigger style={{ width: "100%" }} />
                <Select.Content>
                  <Select.Item value="generic">{t("notifications.formatGeneric")}</Select.Item>
                  <Select.Item value="wecom">{t("notifications.formatWecom")}</Select.Item>
                  <Select.Item value="dingtalk">{t("notifications.formatDingtalk")}</Select.Item>
                  <Select.Item value="feishu">{t("notifications.formatFeishu")}</Select.Item>
                </Select.Content>
              </Select.Root>
            </FormItem>
            <FormItem label="URL" required>
              <TextField.Root
                placeholder="https://"
                value={settings.webhook.url}
                onChange={(e) => updateChannel("webhook", { url: e.target.value })}
              />
              <Text size="1" color="gray" mt="1" as="p">
                {t("notifications.webhookDesc")}
              </Text>
            </FormItem>
          </ChannelBlock>

          <ChannelBlock
            title="Telegram"
            icon="lucide:send"
            enabled={settings.telegram.enabled}
            onToggle={(v) => updateChannel("telegram", { enabled: v })}
          >
            <FormItem label="Bot Token" required>
              <TextField.Root
                type="password"
                autoComplete="off"
                value={settings.telegram.botToken}
                onChange={(e) => updateChannel("telegram", { botToken: e.target.value })}
              />
            </FormItem>
            <FormItem label="Chat ID" required>
              <TextField.Root
                value={settings.telegram.chatId}
                onChange={(e) => updateChannel("telegram", { chatId: e.target.value })}
              />
            </FormItem>
            <FormItem label={t("notifications.telegramApiBase")}>
              <TextField.Root
                placeholder="https://api.telegram.org"
                value={settings.telegram.apiBase}
                onChange={(e) => updateChannel("telegram", { apiBase: e.target.value })}
              />
              <Text size="1" color="gray" mt="1" as="p">
                {t("notifications.telegramApiBaseDesc")}
              </Text>
            </FormItem>
          </ChannelBlock>

          <ChannelBlock
            title="Bark"
            icon="lucide:bell-ring"
            enabled={settings.bark.enabled}
            onToggle={(v) => updateChannel("bark", { enabled: v })}
          >
            <FormItem label={t("notifications.barkServer")}>
              <TextField.Root
                placeholder="https://api.day.app"
                value={settings.bark.serverUrl}
                onChange={(e) => updateChannel("bark", { serverUrl: e.target.value })}
              />
            </FormItem>
            <FormItem label="Device Key" required>
              <TextField.Root
                autoComplete="off"
                value={settings.bark.deviceKey}
                onChange={(e) => updateChannel("bark", { deviceKey: e.target.value })}
              />
            </FormItem>
          </ChannelBlock>

          <ChannelBlock
            title={t("notifications.email")}
            icon="lucide:mail"
            enabled={settings.email.enabled}
            onToggle={(v) => updateChannel("email", { enabled: v })}
          >
            <FormItem label={t("notifications.emailTo")} required>
              <TextField.Root
                placeholder="you@example.com"
                value={settings.email.to}
                onChange={(e) => updateChannel("email", { to: e.target.value })}
              />
              <Text size="1" color="gray" mt="1" as="p">
                {t("notifications.emailDesc")}
              </Text>
            </FormItem>
          </ChannelBlock>
        </Flex>
      </Box>

      {results && results.length > 0 && (
        <Callout.Root color={results.every((r) => r.ok) ? "green" : "orange"} size="1">
          <Callout.Icon>
            <Icon icon={results.every((r) => r.ok) ? "lucide:check-circle" : "lucide:triangle-alert"} width="14" height="14" />
          </Callout.Icon>
          <Flex direction="column" gap="1">
            {results.map((r) => (
              <Flex key={r.channel} gap="2" align="center" wrap="wrap">
                <Badge color={r.ok ? "green" : "red"}>{r.channel}</Badge>
                <Text size="1">{r.ok ? t("notifications.testOk") : r.error}</Text>
              </Flex>
            ))}
          </Flex>
        </Callout.Root>
      )}

      <Separator size="4" />

      <Flex justify="end" gap="3" wrap="wrap">
        <Button variant="soft" color="gray" onClick={sendTest} disabled={testing}>
          <Icon icon={testing ? "lucide:loader-circle" : "lucide:send"} width="16" height="16" className={testing ? "animate-spin" : ""} />
          {t("notifications.sendTest")}
        </Button>
        <Button onClick={save} disabled={saving}>
          <Icon icon={saving ? "lucide:loader-circle" : "lucide:check"} width="16" height="16" className={saving ? "animate-spin" : ""} />
          {saving ? t("settings.saving") : t("settings.saveChanges")}
        </Button>
      </Flex>
    </Flex>
  );
}
