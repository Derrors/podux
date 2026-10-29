import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import pb from "../../lib/pocketbase";
import { notifyError } from "../../lib/notify";
import { STALE } from "../../lib/latestRequest";
import { useLatestRequest } from "../../hooks/useLatestRequest";
import { usePolling } from "../../hooks/usePolling";
import type { Proxy } from "../../types/proxy";

const POLL_INTERVAL_MS = 5000;

/** Proxies of a single server, polled every 5s to keep bootStatus in sync. */
export function useServerProxies(serverId: string | undefined) {
  const { t } = useTranslation();
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const request = useLatestRequest();

  const fetchProxies = useCallback(async () => {
    if (!serverId) return;
    try {
      const result = await request.run((signal) =>
        pb.collection("fh_proxies").getFullList<Proxy>({
          filter: pb.filter("serverId = {:serverId}", { serverId }),
          sort: "-created",
          signal,
        })
      );
      if (result === STALE) return;
      setProxies(result);
    } catch (err) {
      notifyError(t("proxy.fetchFailed"), err, "server-proxies-fetch");
    }
    setLoading(false);
  }, [serverId, request, t]);

  useEffect(() => {
    void fetchProxies();
  }, [fetchProxies]);

  usePolling(fetchProxies, POLL_INTERVAL_MS, { enabled: !!serverId });

  const refresh = async () => {
    setRefreshing(true);
    try {
      await fetchProxies();
    } finally {
      setRefreshing(false);
    }
  };

  const setStatus = (id: string, status: Proxy["status"]) =>
    setProxies((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)));

  // The backend reloads frpc itself on proxy update/delete (record hooks).
  const toggleStatus = async (proxy: Proxy) => {
    if (togglingId === proxy.id) return;
    const newStatus = proxy.status === "enabled" ? "disabled" : "enabled";
    setStatus(proxy.id, newStatus); // optimistic
    setTogglingId(proxy.id);
    try {
      await pb.collection("fh_proxies").update(proxy.id, { status: newStatus });
    } catch (err) {
      setStatus(proxy.id, proxy.status);
      notifyError(t("proxy.updateStatusFailed"), err);
    } finally {
      setTogglingId(null);
    }
  };

  const deleteProxy = async (id: string) => {
    try {
      await pb.collection("fh_proxies").delete(id);
      setProxies((prev) => prev.filter((p) => p.id !== id));
      toast.success(t("proxy.deleteSuccess"));
    } catch (err) {
      notifyError(t("proxy.deleteFailed"), err);
    }
    // Supersedes a poll that may have started before the delete.
    await fetchProxies();
  };

  return { proxies, loading, refreshing, togglingId, toggleStatus, deleteProxy, refresh };
}
