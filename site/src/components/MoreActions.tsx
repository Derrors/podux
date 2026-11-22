import { Icon } from "@iconify/react/offline";
import { DropdownMenu, IconButton } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";

export interface ResourceAction {
  label: string;
  icon: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Secondary and destructive resource actions, reachable without hovering. */
export function MoreActions({
  name,
  actions,
  disabled = false,
}: {
  name: string;
  actions: ResourceAction[];
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <IconButton
          variant="ghost"
          color="gray"
          disabled={disabled}
          aria-label={t("common.moreActionsFor", { name })}
          title={t("common.moreActions")}
        >
          <Icon icon="lucide:ellipsis" width="20" height="20" />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        {actions.map((action) => (
          <DropdownMenu.Item
            key={action.label}
            color={action.danger ? "red" : undefined}
            disabled={action.disabled}
            onSelect={action.onSelect}
          >
            <Icon icon={action.icon} width="15" height="15" />
            {action.label}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
