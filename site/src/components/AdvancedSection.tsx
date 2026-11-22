import { Icon } from "@iconify/react/offline";
import { Text } from "@radix-ui/themes";
import { useState, type ReactNode } from "react";

/** Native disclosure keeps all fields mounted, and exposes validation errors automatically. */
export function AdvancedSection({
  title,
  description,
  children,
  defaultOpen = false,
  invalid = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="advanced-section"
      open={invalid || open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="advanced-section__summary">
        <span className="advanced-section__icon" aria-hidden="true">
          <Icon icon="lucide:sliders-horizontal" width="18" height="18" />
        </span>
        <span className="min-w-0 flex-1">
          <Text as="div" size="3" weight="bold">
            {title}
          </Text>
          {description && (
            <Text as="div" size="2" color="gray">
              {description}
            </Text>
          )}
        </span>
        <Icon
          className="advanced-section__chevron"
          icon="lucide:chevron-down"
          width="18"
          height="18"
          aria-hidden="true"
        />
      </summary>
      <div className="advanced-section__content">{children}</div>
    </details>
  );
}
