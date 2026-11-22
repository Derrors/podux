import { Icon } from "@iconify/react/offline";
import { IconButton, Tooltip } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../contexts/language";

interface LanguageToggleProps {
  language?: "en" | "zh";
  onChange?: (lang: "en" | "zh") => void;
}

export function LanguageToggle({ language: customLanguage, onChange }: LanguageToggleProps = {}) {
  const context = useLanguage();
  const { t } = useTranslation();
  const language = customLanguage ?? context.language;
  const setLanguage = onChange ?? context.setLanguage;
  const label = t("language.switchTo", {
    language: t(language === "en" ? "language.zh" : "language.en"),
  });
  return (
    <Tooltip content={label}>
      <IconButton
        variant="ghost"
        color="gray"
        onClick={() => setLanguage(language === "en" ? "zh" : "en")}
        aria-label={label}
      >
        <Icon icon="lucide:languages" width="19" height="19" />
      </IconButton>
    </Tooltip>
  );
}
