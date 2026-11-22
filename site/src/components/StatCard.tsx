import { Box, Card, Flex, Skeleton, Text } from "@radix-ui/themes";
import type { ReactNode } from "react";

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  color = "gray",
  loading = false,
}: {
  title: string;
  value: ReactNode;
  subtitle?: ReactNode;
  icon: ReactNode;
  color?: "green" | "red" | "blue" | "orange" | "amber" | "purple" | "cyan" | "gray";
  loading?: boolean;
}) {
  const colorMap = {
    green: { ink: "var(--green-10)", background: "var(--green-a3)" },
    red: { ink: "var(--red-10)", background: "var(--red-a3)" },
    blue: { ink: "var(--blue-10)", background: "var(--blue-a3)" },
    orange: { ink: "var(--orange-10)", background: "var(--orange-a3)" },
    amber: { ink: "var(--amber-11)", background: "var(--amber-a3)" },
    purple: { ink: "var(--purple-10)", background: "var(--purple-a3)" },
    cyan: { ink: "var(--cyan-10)", background: "var(--cyan-a3)" },
    gray: { ink: "var(--gray-11)", background: "var(--gray-a3)" },
  };
  return (
    <Card className="stat-card" size="2">
      <Flex justify="between" align="start" gap="2">
        <Text size="2" color="gray" className="min-w-0">
          {title}
        </Text>
        <span
          className="stat-card__icon"
          style={{ color: colorMap[color].ink, background: colorMap[color].background }}
        >
          {icon}
        </span>
      </Flex>
      <Box mt="2" className="min-w-0">
        <Skeleton loading={loading}>
          <Text as="div" size="6" weight="bold" className="stat-card__value">
            {value}
          </Text>
        </Skeleton>
      </Box>
      {subtitle && (
        <Text as="div" size="1" color="gray" mt="2" className="stat-card__subtitle">
          <Skeleton loading={loading}>{subtitle}</Skeleton>
        </Text>
      )}
    </Card>
  );
}
