import { useCallback, useEffect, useRef, useState } from "react";
import { AlertDialog, Badge, Box, Button, Flex, Heading, Select, Separator, Table, Text, TextField } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import i18n from "../../i18n";
import { apiFetch, apiGet, apiPost, apiPut } from "../../lib/api";
import { notifyError } from "../../lib/notify";
import { formatBytes } from "../../lib/format";
import { FormItem } from "../../components/FormItem";
import { ConfirmDeleteDialog } from "../../components/ConfirmDeleteDialog";

interface BackupInfo {
  name: string;
  size: number;
  modified: string;
  auto: boolean;
}

interface Schedule {
  cron: string;
  keep: number;
}

/** Schedule presets; any other stored cron shows as "custom". */
const PRESETS: Record<string, string> = { off: "", daily: "0 3 * * *", weekly: "0 3 * * 0" };
const presetOf = (cron: string) => Object.entries(PRESETS).find(([, c]) => c === cron)?.[0] ?? "custom";

const BASE = "/api/system/backups";

/** Waits until Podux answers its health check again after a restore restarted it. */
async function waitForRestart(timeoutMs = 120_000) {
  const until = Date.now() + timeoutMs;
  await new Promise((r) => setTimeout(r, 3000));
  while (Date.now() < until) {
    try {
      if ((await fetch("/api/health")).ok) return true;
    } catch {
      // still restarting
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export function BackupSettings() {
  const { t } = useTranslation();
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [schedule, setSchedule] = useState<Schedule>({ cron: "", keep: 7 });
  const [preset, setPreset] = useState("off");
  const [busy, setBusy] = useState<string | null>(null);
  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [restoreName, setRestoreName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ backups: BackupInfo[]; schedule: Schedule }>(BASE);
      setBackups(data.backups ?? []);
      setSchedule({ cron: data.schedule.cron, keep: data.schedule.keep || 7 });
      setPreset(presetOf(data.schedule.cron));
    } catch (err) {
      // i18n singleton, not t: t changes per language and would reload the list.
      notifyError(i18n.t("backup.loadFailed"), err);
      setBackups([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const create = () =>
    run("create", async () => {
      try {
        await apiPost(BASE, {});
        toast.success(t("backup.created"));
        await load();
      } catch (err) {
        notifyError(t("backup.createFailed"), err);
      }
    });

  const download = (name: string) =>
    run(`download:${name}`, async () => {
      try {
        const res = await apiFetch(`${BASE}/${encodeURIComponent(name)}`);
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        notifyError(t("backup.downloadFailed"), err);
      }
    });

  const upload = (file: File) =>
    run("upload", async () => {
      try {
        const body = new FormData();
        body.append("file", file);
        await apiFetch(`${BASE}/upload`, { method: "POST", body });
        toast.success(t("backup.uploaded"));
        await load();
      } catch (err) {
        notifyError(t("backup.uploadFailed"), err);
      }
    });

  const remove = (name: string) =>
    run(`delete:${name}`, async () => {
      try {
        await apiFetch(`${BASE}/${encodeURIComponent(name)}`, { method: "DELETE" });
        toast.success(t("backup.deleted"));
        await load();
      } catch (err) {
        notifyError(t("backup.deleteFailed"), err);
      }
    });

  const restore = (name: string) =>
    run("restore", async () => {
      try {
        await apiPost(`${BASE}/${encodeURIComponent(name)}/restore`, {});
      } catch (err) {
        notifyError(t("backup.restoreFailed"), err);
        return;
      }
      const toastId = toast.loading(t("backup.restoring"));
      const ok = await waitForRestart();
      toast.dismiss(toastId);
      if (ok) {
        toast.success(t("backup.restored"));
        // The restored database may hold other users and sessions; start over.
        setTimeout(() => window.location.assign("/"), 1500);
      } else {
        toast.error(t("backup.restoreTimeout"));
      }
    });

  const saveSchedule = () =>
    run("schedule", async () => {
      try {
        const saved = await apiPut<Schedule>(`${BASE}/schedule`, schedule);
        setSchedule({ cron: saved.cron, keep: saved.keep || 7 });
        toast.success(t("settings.saveSuccess"));
      } catch (err) {
        notifyError(t("settings.saveFailed"), err);
      }
    });

  return (
    <Flex direction="column" gap="4">
      <Box>
        <Heading size="4" mb="1">
          {t("backup.title")}
        </Heading>
        <Text size="2" color="gray">
          {t("backup.description")}
        </Text>
      </Box>

      <Separator size="4" />

      <Box>
        <Text size="3" weight="bold" mb="3" style={{ display: "block" }}>
          {t("backup.schedule")}
        </Text>
        <Flex gap="3" wrap="wrap" align="end">
          <FormItem label={t("backup.frequency")}>
            <Select.Root
              value={preset}
              onValueChange={(v) => {
                setPreset(v);
                if (v !== "custom") setSchedule((s) => ({ ...s, cron: PRESETS[v] }));
              }}
            >
              <Select.Trigger style={{ minWidth: 180 }} />
              <Select.Content>
                {["off", "daily", "weekly", "custom"].map((p) => (
                  <Select.Item key={p} value={p}>
                    {t(`backup.preset.${p}`)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </FormItem>
          {preset === "custom" && (
            <FormItem label={t("backup.cron")}>
              <TextField.Root
                className="font-mono"
                placeholder="0 3 * * *"
                value={schedule.cron}
                onChange={(e) => setSchedule((s) => ({ ...s, cron: e.target.value }))}
              />
            </FormItem>
          )}
          {preset !== "off" && (
            <FormItem label={t("backup.keep")}>
              <TextField.Root
                type="number"
                min="1"
                style={{ width: 100 }}
                value={String(schedule.keep)}
                onChange={(e) => setSchedule((s) => ({ ...s, keep: Math.max(1, parseInt(e.target.value) || 1) }))}
              />
            </FormItem>
          )}
          <Button onClick={saveSchedule} disabled={busy === "schedule"}>
            <Icon icon="lucide:check" width="16" height="16" />
            {t("settings.saveChanges")}
          </Button>
        </Flex>
        <Text size="1" color="gray" mt="2" as="p">
          {t("backup.scheduleDesc")}
        </Text>
      </Box>

      <Separator size="4" />

      <Flex justify="between" align="center" wrap="wrap" gap="2">
        <Text size="3" weight="bold">
          {t("backup.list")}
        </Text>
        <Flex gap="2">
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
          <Button variant="soft" color="gray" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
            <Icon icon="lucide:upload" width="16" height="16" />
            {t("backup.upload")}
          </Button>
          <Button disabled={busy !== null} onClick={create}>
            <Icon icon={busy === "create" ? "lucide:loader-2" : "lucide:archive"} className={busy === "create" ? "animate-spin" : ""} width="16" height="16" />
            {t("backup.create")}
          </Button>
        </Flex>
      </Flex>

      {backups === null ? (
        <Flex justify="center" py="6">
          <Icon icon="lucide:loader-circle" width="24" height="24" className="animate-spin" />
        </Flex>
      ) : backups.length === 0 ? (
        <Text size="2" color="gray">
          {t("backup.empty")}
        </Text>
      ) : (
        <div className="overflow-x-auto">
          <Table.Root variant="surface" size="1">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>{t("common.name")}</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>{t("backup.size")}</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>{t("backup.time")}</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>{t("common.actions")}</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {backups.map((b) => (
                <Table.Row key={b.name}>
                  <Table.Cell>
                    <Flex gap="2" align="center">
                      <Text size="2" className="font-mono">
                        {b.name}
                      </Text>
                      {b.auto && (
                        <Badge size="1" variant="soft">
                          {t("backup.auto")}
                        </Badge>
                      )}
                    </Flex>
                  </Table.Cell>
                  <Table.Cell>{formatBytes(b.size)}</Table.Cell>
                  <Table.Cell>{new Date(b.modified).toLocaleString()}</Table.Cell>
                  <Table.Cell>
                    <Flex gap="2">
                      <Button size="1" variant="soft" disabled={busy !== null} onClick={() => download(b.name)}>
                        <Icon icon="lucide:download" width="14" height="14" />
                        {t("backup.download")}
                      </Button>
                      <Button size="1" variant="soft" color="orange" disabled={busy !== null} onClick={() => setRestoreName(b.name)}>
                        <Icon icon="lucide:history" width="14" height="14" />
                        {t("backup.restore")}
                      </Button>
                      <Button size="1" variant="soft" color="red" disabled={busy !== null} onClick={() => setDeleteName(b.name)}>
                        <Icon icon="lucide:trash-2" width="14" height="14" />
                        {t("common.delete")}
                      </Button>
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </div>
      )}

      <ConfirmDeleteDialog
        open={deleteName !== null}
        title={t("backup.deleteTitle")}
        description={t("backup.deleteConfirm", { name: deleteName ?? "" })}
        onClose={() => setDeleteName(null)}
        onConfirm={() => {
          if (deleteName) void remove(deleteName);
          setDeleteName(null);
        }}
      />

      <AlertDialog.Root open={restoreName !== null} onOpenChange={(o) => !o && setRestoreName(null)}>
        <AlertDialog.Content maxWidth="480px">
          <AlertDialog.Title>{t("backup.restoreTitle")}</AlertDialog.Title>
          <AlertDialog.Description size="2">{t("backup.restoreConfirm", { name: restoreName ?? "" })}</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                {t("common.cancel")}
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                color="orange"
                onClick={() => {
                  if (restoreName) void restore(restoreName);
                  setRestoreName(null);
                }}
              >
                {t("backup.restore")}
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  );
}
