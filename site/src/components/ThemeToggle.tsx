import { Icon } from "@iconify/react/offline";
import { IconButton, Tooltip } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { useTheme } from "../contexts/theme";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  const label = t(theme === "light" ? "settings.switchToDark" : "settings.switchToLight");
  return (
    <Tooltip content={label}>
      <IconButton variant="ghost" color="gray" onClick={toggleTheme} aria-label={label}>
        <Icon icon={theme === "light" ? "lucide:sun" : "lucide:moon"} width="19" height="19" />
      </IconButton>
    </Tooltip>
  );
}
