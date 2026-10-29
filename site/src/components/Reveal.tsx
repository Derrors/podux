import type { ReactNode } from "react";
import { motion } from "framer-motion";

interface RevealProps {
  visible: boolean;
  delay?: number;
  className?: string;
  children: ReactNode;
}

/** Standard page-section entrance: fade in and slide up once `visible` turns true. */
export function Reveal({ visible, delay = 0, className, children }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
