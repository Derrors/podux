import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import pb from "../../lib/pocketbase";
import { notifyError } from "../../lib/notify";
import { batchErrorMessage, firstFieldError } from "../../lib/fieldErrors";
import { apiGet, apiPost } from "../../lib/api";
import { useProxyStatus } from "../../hooks/useProxyStatus";
import type { ServerOption } from "./ProxyFormPage/useProxyForm";
import { usePaginatedList, type PageQuery, type PageResult } from "../../hooks/usePaginatedList";
import type { Proxy } from "../../types/proxy";
import {
  buildProxyFilter,
  DEFAULT_PROXY_FILTERS,
  hasProxyFilters,
  normalizeProxyFilter,
  proxyFiltersKey,
  proxySelectionKey,
  type ProxyFilters,
} from "./proxyFilters";

const PER_PAGE = 10;

interface ProxyPage extends PageResult<Proxy> {
  /** Stat card counts: all proxies, independent of search and filters. */
  allCount: number;
  onlineCount: number;
}

export function useProxies() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<ProxyFilters>(() => ({ ...DEFAULT_PROXY_FILTERS }));
  const setFilter = useCallback((key: keyof ProxyFilters, value: string) => {
    const normalized = normalizeProxyFilter(key, value);
    setFilters((current) => current[key] === normalized ? current : { ...current, [key]: normalized });
  }, []);
  const resetFilters = useCallback(() => setFilters({ ...DEFAULT_PROXY_FILTERS }), []);
  const hasFilters = hasProxyFilters(filters);
  const queryKey = proxyFiltersKey(filters);

  const fetchPage = useCallback(
    async ({ page, perPage, search, signal }: PageQuery): Promise<ProxyPage> => {
      const filter = buildProxyFilter(filters, search, (expression, params) => pb.filter(expression, params));
      const proxies = pb.collection("fh_proxies");
      const [result, online, all] = await Promise.all([
        proxies.getList<Proxy>(page, perPage, {
          sort: "-created",
          expand: "serverId",
          filter,
          signal,
        }),
        proxies.getList(1, 1, { filter: 'status = "enabled" && bootStatus = "online"', signal }),
        // Only the completely unfiltered page query counts every proxy.
        filter ? proxies.getList(1, 1, { signal }) : null,
      ]);
      return {
        items: result.items,
        totalPages: result.totalPages,
        totalItems: result.totalItems,
        allCount: all ? all.totalItems : result.totalItems,
        onlineCount: online.totalItems,
      };
    },
    [filters]
  );

  const list = usePaginatedList<Proxy, ProxyPage>({
    fetchPage,
    queryKey,
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

  // Selection is scoped to a page, search and filters; it cannot act on stale rows while loading.
  const pageKey = proxySelectionKey(list.page, list.search, filters);
  const [selection, setSelection] = useState<{ key: string; version: number; ids: Set<string> }>(
    () => ({ key: pageKey, version: 0, ids: new Set() })
  );
  const selectionVersion = selection.version + (selection.key !== pageKey ? 1 : 0);
  const pageIds = new Set(list.items.map((proxy) => proxy.id));
  const selected = selection.key === pageKey && !list.loading
    ? new Set([...selection.ids].filter((id) => pageIds.has(id)))
    : new Set<string>();
  if (selection.key !== pageKey || (!list.loading && selected.size !== selection.ids.size)) {
    setSelection({ key: pageKey, version: selectionVersion, ids: selected });
  }
  const selectionScope = useRef({ key: pageKey, version: selectionVersion, ready: !list.loading, pageIds, selected });
  useLayoutEffect(() => {
    selectionScope.current = { key: pageKey, version: selectionVersion, ready: !list.loading, pageIds, selected };
  });
  const setSelected = (update: Set<string> | ((prev: Set<string>) => Set<string>)) =>
    setSelection((prev) => {
      const scope = selectionScope.current;
      // A completed batch may hold an old callback after the user changed the query.
      if (scope.key !== pageKey || scope.version !== selectionVersion || !scope.ready) return prev;
      const current = prev.key === pageKey
        ? new Set([...prev.ids].filter((id) => scope.pageIds.has(id)))
        : new Set<string>();
      const next = typeof update === "function" ? update(current) : update;
      return { key: pageKey, version: selectionVersion, ids: new Set([...next].filter((id) => scope.pageIds.has(id))) };
    });
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);
  const { statuses, subdomainHosts } = useProxyStatus();

  useEffect(() => {
    apiGet<ServerOption[] | null>("/api/servers/options")
      .then((s) => setServers(s ?? []))
      .catch(() => undefined);
  }, []);

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectPage = (all: boolean) => setSelected(all ? new Set(list.items.map((p) => p.id)) : new Set());

  const runBatch = async (action: "enable" | "disable" | "delete" | "move", serverId?: string) => {
    const scope = selectionScope.current;
    if (scope.key !== pageKey || scope.version !== selectionVersion || !scope.ready || batchBusy) return;
    const ids = [...scope.selected];
    if (ids.length === 0) return;
    setBatchBusy(true);
    await runMutation(async () => {
      try {
        await apiPost("/api/proxies/batch", { ids, action, serverId });
        toast.success(t(`proxy.batchDone.${action}`, { count: ids.length }));
        setSelected(new Set());
      } catch (err) {
        const message = batchErrorMessage(err, t);
        if (message) toast.error(t("proxy.batchFailed"), { description: message });
        else notifyError(t("proxy.batchFailed"), err);
      }
    });
    setBatchBusy(false);
    await reload();
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
    statuses,
    subdomainHosts,
    servers,
    selected,
    toggleSelected,
    selectPage,
    runBatch,
    batchBusy,
    page: list.page,
    setPage: list.setPage,
    totalPages: list.totalPages,
    search: list.search,
    setSearch: list.setSearch,
    filters,
    setFilter,
    resetFilters,
    hasFilters,
    totalItems: list.totalItems,
    refreshProxies: list.refresh,
  };
}
