import { useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import pb from "../../lib/pocketbase";
import { notifyError } from "../../lib/notify";
import { firstFieldError } from "../../lib/fieldErrors";
import { usePaginatedList, type PageQuery, type PageResult } from "../../hooks/usePaginatedList";
import type { Visitor } from "../../types/visitor";

const PER_PAGE = 10;

export function useVisitors() {
  const { t } = useTranslation();

  const fetchPage = useCallback(
    async ({ page, perPage, search, signal }: PageQuery): Promise<PageResult<Visitor>> => {
      const filter = search ? pb.filter("name ~ {:q} || serverName ~ {:q}", { q: search }) : "";
      const result = await pb.collection("fh_visitors").getList<Visitor>(page, perPage, {
        sort: "-created",
        expand: "serverId",
        filter,
        signal,
      });
      return { items: result.items, totalPages: result.totalPages, totalItems: result.totalItems };
    },
    []
  );

  const list = usePaginatedList<Visitor>({
    fetchPage,
    perPage: PER_PAGE,
    onError: (err) => notifyError(t("visitor.fetchFailed"), err, "visitors-fetch"),
  });
  const { reload, mutate, runMutation } = list;

  // The backend reloads frpc itself on visitor create/update/delete (record hooks).
  const deleteVisitor = async (id: string) => {
    try {
      await pb.collection("fh_visitors").delete(id);
      toast.success(t("visitor.deleteSuccess"));
    } catch (err) {
      notifyError(t("visitor.deleteFailed"), err);
    }
    await reload();
  };

  const setStatus = (id: string, status: Visitor["status"]) =>
    mutate((current) => ({
      ...current,
      items: current.items.map((v) => (v.id === id ? { ...v, status } : v)),
    }));

  const toggleStatus = async (visitor: Visitor) => {
    const newStatus = visitor.status === "enabled" ? "disabled" : "enabled";
    setStatus(visitor.id, newStatus); // optimistic
    await runMutation(async () => {
      try {
        await pb.collection("fh_visitors").update(visitor.id, { status: newStatus });
      } catch (err) {
        setStatus(visitor.id, visitor.status);
        // Enabling can collide with another visitor's local port; say which.
        const conflict = firstFieldError(err, t);
        if (conflict) toast.error(t("visitor.updateStatusFailed"), { description: conflict });
        else notifyError(t("visitor.updateStatusFailed"), err);
      }
    });
  };

  return {
    visitors: list.items,
    loading: list.loading,
    refreshing: list.refreshing,
    deleteVisitor,
    toggleStatus,
    page: list.page,
    setPage: list.setPage,
    totalPages: list.totalPages,
    search: list.search,
    setSearch: list.setSearch,
    refreshVisitors: list.refresh,
  };
}
