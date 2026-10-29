import { Flex, Text } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";

interface PaginationBarProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const edgeButtonStyle = (disabled: boolean) => ({
  padding: "6px 10px",
  background: "none",
  border: "none",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.4 : 1,
  display: "flex",
  alignItems: "center",
  color: "inherit",
});

/** Page indicator plus numbered page buttons; renders nothing for a single page. */
export function PaginationBar({ page, totalPages, onPageChange }: PaginationBarProps) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;

  return (
    <Flex justify="between" align="center" pt="4" px="1">
      <Text size="2" color="gray">
        {page} / {totalPages}
      </Text>
      <Flex
        align="center"
        style={{
          border: "1px solid var(--gray-6)",
          borderRadius: "var(--radius-3)",
          overflow: "hidden",
        }}
      >
        <button
          type="button"
          aria-label={t("common.previousPage")}
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
          style={{ ...edgeButtonStyle(page === 1), borderRight: "1px solid var(--gray-6)" }}
        >
          <Icon icon="lucide:chevron-left" width="14" height="14" />
        </button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
          <button
            type="button"
            key={p}
            aria-current={p === page ? "page" : undefined}
            onClick={() => onPageChange(p)}
            style={{
              padding: "6px 12px",
              background: p === page ? "var(--accent-9)" : "none",
              color: p === page ? "var(--accent-contrast)" : "inherit",
              border: "none",
              borderRight: p === totalPages ? "none" : "1px solid var(--gray-6)",
              cursor: "pointer",
              fontSize: "var(--font-size-2)",
              fontWeight: p === page ? 600 : 400,
            }}
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          aria-label={t("common.nextPage")}
          disabled={page === totalPages}
          onClick={() => onPageChange(page + 1)}
          style={{ ...edgeButtonStyle(page === totalPages), borderLeft: "1px solid var(--gray-6)" }}
        >
          <Icon icon="lucide:chevron-right" width="14" height="14" />
        </button>
      </Flex>
    </Flex>
  );
}
