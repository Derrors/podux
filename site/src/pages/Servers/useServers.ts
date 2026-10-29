import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import pb from "../../lib/pocketbase";
import { apiGet, apiPost } from "../../lib/api";
import { notifyError } from "../../lib/notify";
import { usePaginatedList, type PageQuery } from "../../hooks/usePaginatedList";
import type { ServerListItem, ServerListResponse } from "../../types/server";

const PER_PAGE = 10;

interface ServerPage extends ServerListResponse {
  /** Stat card counts: all servers, independent of the page and the search. */
  allCount: number;
  runningCount: number;
}

export function useServers() {
  const { t } = useTranslation();

  const fetchPage = useCallback(
    async ({ page, perPage, search, signal }: PageQuery): Promise<ServerPage> => {
      const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
      if (search) params.set("search", search);
      const servers = pb.collection("fh_servers");
      const [result, running, all] = await Promise.all([
        apiGet<ServerListResponse>(`/api/servers?${params}`, { signal }),
        servers.getList(1, 1, { filter: 'bootStatus = "running"', fields: "id", signal }),
        // Without a search the page query already counts every server.
        search ? servers.getList(1, 1, { fields: "id", signal }) : null,
      ]);
      return {
        ...result,
        allCount: all ? all.totalItems : result.totalItems,
        runningCount: running.totalItems,
      };
    },
    []
  );

  const list = usePaginatedList<ServerListItem, ServerPage>({
    fetchPage,
    perPage: PER_PAGE,
    onError: (err) => notifyError(t("server.fetchFailed"), err, "servers-fetch"),
  });
  const { reload } = list;

  // Server id with a launch/terminate request in flight.
  const [pendingId, setPendingId] = useState<string | null>(null);

  const deleteServer = async (id: string) => {
    try {
      await pb.collection("fh_servers").delete(id);
      toast.success(t("server.deleteSuccess"));
    } catch (err) {
      notifyError(t("server.deleteFailed"), err);
    }
    await reload();
  };

  const runAction = async (id: string, endpoint: string, successKey: string, failedKey: string) => {
    if (pendingId) return;
    setPendingId(id);
    try {
      await apiPost(endpoint, { id });
      toast.success(t(successKey));
    } catch (err) {
      notifyError(t(failedKey), err);
    } finally {
      setPendingId(null);
    }
    await reload();
  };

  const launchServer = (id: string) =>
    runAction(id, "/api/frpc/launch", "server.startSuccess", "server.startFailed");

  const terminateServer = (id: string) =>
    runAction(id, "/api/frpc/terminate", "server.stopSuccess", "server.stopFailed");

  const totalCount = list.result?.allCount ?? 0;
  const runningCount = list.result?.runningCount ?? 0;

  return {
    servers: list.items,
    stats: {
      total: totalCount,
      running: runningCount,
      // The counts come from separate queries; never show a negative number in between.
      stopped: Math.max(0, totalCount - runningCount),
    },
    loading: list.loading,
    refreshing: list.refreshing,
    page: list.page,
    setPage: list.setPage,
    totalPages: list.totalPages,
    search: list.search,
    setSearch: list.setSearch,
    refreshServers: list.refresh,
    pendingId,
    deleteServer,
    launchServer,
    terminateServer,
  };
}
