import { useEffect, useState } from "react";

/** Turns true after `delayMs`, used to start entrance animations once PageTransition finished. */
export function useDelayedMount(delayMs = 100) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  return mounted;
}
