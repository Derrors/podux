import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

interface RevealProps {
  visible: boolean;
  delay?: number;
  className?: string;
  children: ReactNode;
}

/** Standard page-section entrance: fade in and slide up once `visible` turns true. */
export function Reveal({ visible, delay = 0, className, children }: RevealProps) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: reducedMotion ? 0 : 8 }}
      transition={{
        duration: reducedMotion ? 0 : 0.2,
        delay: reducedMotion ? 0 : Math.min(delay, 0.12),
        ease: "easeOut",
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
