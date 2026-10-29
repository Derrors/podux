import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import pb from "../../lib/pocketbase";
import { apiPost, getErrorMessage } from "../../lib/api";
import { notifyError } from "../../lib/notify";
import { STALE } from "../../lib/latestRequest";
import { useLatestRequest } from "../../hooks/useLatestRequest";
import type { ServerRecord } from "../../types/server";
import { useServerProxies } from "./useServerProxies";
import { useProbeHistory } from "./useProbeHistory";

export function useServerDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [server, setServer] = useState<ServerRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const request = useLatestRequest();

  const proxies = useServerProxies(id);
  const probeHistory = useProbeHistory(id);

  const fetchServer = useCallback(async () => {
    if (!id) return;
    try {
      const record = await request.run((signal) =>
        pb.collection("fh_servers").getOne<ServerRecord>(id, { signal })
      );
      if (record === STALE) return;
      setServer(record);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err) || t("server.failedToLoad"));
      notifyError(t("server.failedToLoad"), err);
    }
    setLoading(false);
  }, [id, request, t]);

  useEffect(() => {
    void fetchServer();
  }, [fetchServer]);

  const runAction = async (endpoint: string, successKey: string, failedKey: string) => {
    if (!id || actionLoading) return;
    setActionLoading(true);
    try {
      await apiPost(endpoint, { id });
      toast.success(t(successKey));
    } catch (err) {
      notifyError(t(failedKey), err);
    } finally {
      setActionLoading(false);
    }
    await fetchServer();
  };

  const handleStart = () => runAction("/api/frpc/launch", "server.startSuccess", "server.startFailed");
  const handleStop = () => runAction("/api/frpc/terminate", "server.stopSuccess", "server.stopFailed");

  return {
    serverId: id,
    server,
    loading,
    error,
    actionLoading,
    handleStart,
    handleStop,
    proxies,
    probeHistory,
  };
}
