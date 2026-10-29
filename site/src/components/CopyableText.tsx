import { useEffect, useState } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "../lib/clipboard";

interface CopyableTextProps {
  text: string;
  color?: "gray";
}

/** Small text with a copy icon; click copies the text and briefly shows a check mark. */
export function CopyableText({ text, color }: CopyableTextProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = () => {
    copyToClipboard(text).then(
      () => setCopied(true),
      () => {
        // Copy is best-effort; nothing useful to show on failure.
      }
    );
  };

  return (
    <Flex
      align="center"
      gap="1"
      style={{ cursor: "pointer" }}
      onClick={handleCopy}
      title={copied ? t("common.copied") : t("common.clickToCopy")}
    >
      <Text size="2" color={color}>
        {text}
      </Text>
      <Icon
        icon={copied ? "lucide:check" : "lucide:copy"}
        width="12"
        height="12"
        color={copied ? "var(--green-9)" : "var(--gray-8)"}
      />
    </Flex>
  );
}
