import { useEffect, useState } from "react";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "../lib/clipboard";

interface CopyableTextProps {
  text: string;
  color?: "gray";
}

/** A real button with a wrapping label, so addresses remain usable on mobile and keyboard. */
export function CopyableText({ text, color }: CopyableTextProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="copyable-text"
      style={{ color: color === "gray" ? "var(--gray-11)" : undefined }}
      onClick={() => {
        void copyToClipboard(text).then(
          () => setCopied(true),
          () => undefined
        );
      }}
      aria-label={t("common.copyValue", { value: text })}
      title={copied ? t("common.copied") : t("common.clickToCopy")}
    >
      <span className="copyable-text__value">{text}</span>
      <Icon
        icon={copied ? "lucide:check" : "lucide:copy"}
        width="12"
        height="12"
        style={{ color: copied ? "var(--green-11)" : "var(--gray-10)", flexShrink: 0 }}
        aria-hidden="true"
      />
    </button>
  );
}
