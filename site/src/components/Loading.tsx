import { Flex, Text } from "@radix-ui/themes";
import { motion } from "framer-motion";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";

interface LoadingProps {
  /** Defaults to the translated "Loading..."; pass "" to hide the text. */
  text?: string;
  size?: "small" | "medium" | "large";
  minHeight?: string | number;
  fullscreen?: boolean;
}

const sizeMap = {
  small: 24,
  medium: 32,
  large: 48,
};

export function Loading({ text, size = "medium", minHeight, fullscreen = false }: LoadingProps) {
  const { t } = useTranslation();
  if (text === undefined) text = t("common.loading");
  const iconSize = sizeMap[size];

  const containerStyle = fullscreen
    ? {
        position: "fixed" as const,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--gray-2)",
        zIndex: 9999,
      }
    : {
        minHeight: minHeight || "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      };

  if (fullscreen) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        style={containerStyle}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
          }}
        >
          <Icon
            icon="lucide:loader-circle"
            width={iconSize}
            height={iconSize}
            className="animate-spin"
            style={{ color: "var(--accent-9)" }}
          />
          {text && (
            <Text size="2" color="gray">
              {text}
            </Text>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      style={containerStyle}
    >
      <Flex direction="column" align="center" justify="center" gap="3">
        <Icon
          icon="lucide:loader-circle"
          width={iconSize}
          height={iconSize}
          className="animate-spin"
          style={{ color: "var(--accent-9)" }}
        />
        {text && (
          <Text size="2" color="gray">
            {text}
          </Text>
        )}
      </Flex>
    </motion.div>
  );
}
