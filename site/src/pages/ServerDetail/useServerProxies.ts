import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import pb from "../../lib/pocketbase";
import { notifyError } from "../../lib/notify";
import { firstFieldError } from "../../lib/fieldErrors";
import { STALE } from "../../lib/latestRequest";
import { createMutationGuard } from "../../lib/mutationGuard";
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
  const [mutations] = useState(createMutationGuard);

  const fetchProxies = useCallback(async () => {
    if (!serverId) return;
    const token = mutations.begin();
    try {
      const result = await request.run((signal) =>
        pb.collection("fh_proxies").getFullList<Proxy>({
          filter: pb.filter("serverId = {:serverId}", { serverId }),
          sort: "-created",
          signal,
        })
      );
      if (result === STALE) return;
      // The response may predate an optimistic toggle; the fetch after the toggle settles it.
      if (!mutations.isCurrent(token)) return;
      setProxies(result);
    } catch (err) {
      notifyError(i18n.t("proxy.fetchFailed"), err, "server-proxies-fetch");
    }
    setLoading(false);
  }, [serverId, request, mutations]);

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
    // Abort the in-flight poll so its older response can't overwrite the optimistic status.
    request.abort();
    setStatus(proxy.id, newStatus); // optimistic
    setTogglingId(proxy.id);
    await mutations.run(async () => {
      try {
        await pb.collection("fh_proxies").update(proxy.id, { status: newStatus });
      } catch (err) {
        setStatus(proxy.id, proxy.status);
        const conflict = firstFieldError(err, t);
        if (conflict) toast.error(t("proxy.updateStatusFailed"), { description: conflict });
        else notifyError(t("proxy.updateStatusFailed"), err);
      }
    });
    setTogglingId(null);
    await fetchProxies();
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
