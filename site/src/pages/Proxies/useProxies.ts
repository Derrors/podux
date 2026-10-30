import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import pb from "../../lib/pocketbase";
import { notifyError } from "../../lib/notify";
import { firstFieldError } from "../../lib/fieldErrors";
import { usePaginatedList, type PageQuery, type PageResult } from "../../hooks/usePaginatedList";
import type { Proxy } from "../../types/proxy";

const PER_PAGE = 10;

interface ProxyPage extends PageResult<Proxy> {
  /** Stat card counts: all proxies, independent of the search. */
  allCount: number;
  onlineCount: number;
}

export function useProxies() {
  const { t } = useTranslation();

  const fetchPage = useCallback(
    async ({ page, perPage, search, signal }: PageQuery): Promise<ProxyPage> => {
      const filter = search
        ? pb.filter("name ~ {:q} || localIP ~ {:q} || remotePort ~ {:q}", { q: search })
        : "";
      const proxies = pb.collection("fh_proxies");
      const [result, online, all] = await Promise.all([
        proxies.getList<Proxy>(page, perPage, {
          sort: "-created",
          expand: "serverId",
          filter,
          signal,
        }),
        proxies.getList(1, 1, { filter: 'bootStatus = "online"', signal }),
        // Without a search the page query already counts every proxy.
        search ? proxies.getList(1, 1, { signal }) : null,
      ]);
      return {
        items: result.items,
        totalPages: result.totalPages,
        totalItems: result.totalItems,
        allCount: all ? all.totalItems : result.totalItems,
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
  const { reload, mutate, runMutation } = list;

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
    // Polls overlapping the update are dropped and the list is reloaded afterwards.
    await runMutation(async () => {
      try {
        await pb.collection("fh_proxies").update(proxy.id, { status: newStatus });
      } catch (err) {
        setStatus(proxy.id, proxy.status);
        // Enabling can collide with another proxy's port or domain; say which.
        const conflict = firstFieldError(err, t);
        if (conflict) toast.error(t("proxy.updateStatusFailed"), { description: conflict });
        else notifyError(t("proxy.updateStatusFailed"), err);
      }
    });
  };

  const totalCount = list.result?.allCount ?? 0;
  const onlineCount = list.result?.onlineCount ?? 0;

  return {
    proxies: list.items,
    loading: list.loading,
    refreshing: list.refreshing,
    stats: {
      total: totalCount,
      online: onlineCount,
      // The counts come from separate queries; never show a negative number in between.
      offline: Math.max(0, totalCount - onlineCount),
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
