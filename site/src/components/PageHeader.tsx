import { Box, Flex, Heading } from "@radix-ui/themes";
import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  extra?: ReactNode;
  visible?: boolean;
}

export function PageHeader({ title, extra, visible = true }: PageHeaderProps) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: reducedMotion ? 0 : -8 }}
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: reducedMotion ? 0 : -8 }}
      transition={{ duration: reducedMotion ? 0 : 0.2, ease: "easeOut" }}
      className="page-header"
    >
      <Flex justify="between" gap="4" className="page-header__layout">
        <Box className="min-w-0">
          <Heading size="6" className="page-header__title">
            {title}
          </Heading>
        </Box>
        {extra && <Box className="page-header__actions">{extra}</Box>}
      </Flex>
    </motion.div>
  );
}
