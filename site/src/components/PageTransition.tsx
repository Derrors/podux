import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import type { ReactNode } from "react";

interface PageTransitionProps extends HTMLMotionProps<"div"> {
  children: ReactNode;
}

export function PageTransition({ children, ...props }: PageTransitionProps) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
      transition={{
        duration: reducedMotion ? 0 : 0.18,
        ease: [0.22, 1, 0.36, 1], // Custom cubic-bezier for a more premium feel
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
