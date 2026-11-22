import type { ReactNode } from "react";
import { Flex, Text } from "@radix-ui/themes";

export function ResourceListToolbar({
  title,
  children,
  actions,
  summary,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  summary?: ReactNode;
}) {
  return (
    <div className="resource-toolbar">
      <Flex justify="between" align="center" gap="3" wrap="wrap">
        <Text as="div" size="3" weight="bold">
          {title}
        </Text>
        {actions}
      </Flex>
      <div className="resource-toolbar__controls">{children}</div>
      {summary && (
        <Text as="div" size="1" color="gray">
          {summary}
        </Text>
      )}
    </div>
  );
}
