import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import pb from "../../lib/pocketbase";
import { notifyError } from "../../lib/notify";
import { usePaginatedList, type PageQuery, type PageResult } from "../../hooks/usePaginatedList";
import type { Proxy } from "../../types/proxy";

const PER_PAGE = 10;

interface ProxyPage extends PageResult<Proxy> {
  onlineCount: number;
}

export function useProxies() {
  const { t } = useTranslation();

  const fetchPage = useCallback(
    async ({ page, perPage, search, signal }: PageQuery): Promise<ProxyPage> => {
      const filter = search
        ? pb.filter("name ~ {:q} || localIP ~ {:q} || remotePort ~ {:q}", { q: search })
        : "";
      const [result, online] = await Promise.all([
        pb.collection("fh_proxies").getList<Proxy>(page, perPage, {
          sort: "-created",
          expand: "serverId",
          filter,
          signal,
        }),
        pb.collection("fh_proxies").getList(1, 1, {
          filter: 'bootStatus = "online"',
          signal,
        }),
      ]);
      return {
        items: result.items,
        totalPages: result.totalPages,
        totalItems: result.totalItems,
        onlineCount: online.totalItems,
      };
    },
    []
  );

  const list = usePaginatedList<Proxy, ProxyPage>({
    fetchPage,
    perPage: PER_PAGE,
    onError: (err) => notifyError(t("proxy.fetchFailed"), err, "proxies-fetch"),
  });
  const { reload, mutate } = list;

  // The backend reloads frpc itself on proxy create/update/delete (record hooks).
  const deleteProxy = async (id: string) => {
    try {
      await pb.collection("fh_proxies").delete(id);
      toast.success(t("proxy.deleteSuccess"));
    } catch (err) {
      notifyError(t("proxy.deleteFailed"), err);
    }
    await reload();
  };

  const setStatus = (id: string, status: Proxy["status"]) =>
    mutate((current) => ({
      ...current,
      items: current.items.map((p) => (p.id === id ? { ...p, status } : p)),
    }));

  const toggleStatus = async (proxy: Proxy) => {
    const newStatus = proxy.status === "enabled" ? "disabled" : "enabled";
    setStatus(proxy.id, newStatus); // optimistic
    try {
      await pb.collection("fh_proxies").update(proxy.id, { status: newStatus });
    } catch (err) {
      setStatus(proxy.id, proxy.status);
      notifyError(t("proxy.updateStatusFailed"), err);
    }
  };

  const totalItems = list.result?.totalItems ?? 0;
  const onlineCount = list.result?.onlineCount ?? 0;

  return {
    proxies: list.items,
    loading: list.initialLoading,
    refreshing: list.refreshing,
    stats: {
      total: totalItems,
      online: onlineCount,
      offline: totalItems - onlineCount,
    },
    deleteProxy,
    toggleStatus,
    page: list.page,
    setPage: list.setPage,
    totalPages: list.totalPages,
    search: list.search,
    setSearch: list.setSearch,
    refreshProxies: list.refresh,
  };
}
