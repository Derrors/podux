import { Flex, Text } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import { pageWindow } from "../lib/pagination";

interface PaginationBarProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const divider = "1px solid var(--gray-6)";

const edgeButtonStyle = (disabled: boolean) => ({
  padding: "6px 8px",
  background: "none",
  border: "none",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.4 : 1,
  display: "flex",
  alignItems: "center",
  color: "inherit",
});

/** Page indicator plus a compact window of page buttons; renders nothing for a single page. */
export function PaginationBar({ page, totalPages, onPageChange }: PaginationBarProps) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;

  return (
    <Flex justify="between" align="center" gap="2" pt="4" px="1">
      <Text size="2" color="gray" className="hidden sm:block">
        {page} / {totalPages}
      </Text>
      <nav aria-label={t("common.pagination")} className="ml-auto">
        <Flex
          align="center"
          style={{ border: divider, borderRadius: "var(--radius-3)", overflow: "hidden" }}
        >
          <button
            type="button"
            aria-label={t("common.previousPage")}
            disabled={page === 1}
            onClick={() => onPageChange(page - 1)}
            style={edgeButtonStyle(page === 1)}
          >
            <Icon icon="lucide:chevron-left" width="14" height="14" />
          </button>
          {pageWindow(page, totalPages).map((slot, i, slots) =>
            slot === "gap" ? (
              <span
                key={`gap-${slots[i - 1]}`}
                aria-hidden="true"
                style={{ padding: "6px 4px", borderLeft: divider, color: "var(--gray-11)" }}
              >
                …
              </span>
            ) : (
              <button
                type="button"
                key={slot}
                aria-current={slot === page ? "page" : undefined}
                onClick={() => onPageChange(slot)}
                style={{
                  minWidth: "30px",
                  padding: "6px 6px",
                  background: slot === page ? "var(--accent-9)" : "none",
                  color: slot === page ? "var(--accent-contrast)" : "inherit",
                  border: "none",
                  borderLeft: divider,
                  cursor: "pointer",
                  fontSize: "var(--font-size-2)",
                  fontWeight: slot === page ? 600 : 400,
                }}
              >
                {slot}
              </button>
            )
          )}
          <button
            type="button"
            aria-label={t("common.nextPage")}
            disabled={page === totalPages}
            onClick={() => onPageChange(page + 1)}
            style={{ ...edgeButtonStyle(page === totalPages), borderLeft: divider }}
          >
            <Icon icon="lucide:chevron-right" width="14" height="14" />
          </button>
        </Flex>
      </nav>
    </Flex>
  );
}
