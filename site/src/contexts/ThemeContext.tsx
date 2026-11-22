import { useState, useEffect, type ReactNode } from "react";
import { ThemeContext, type Theme } from "./theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      /* Storage may be disabled; still follow the system appearance. */
    }
    return typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  useEffect(() => {
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* In-memory theme remains usable. */
    }
  }, [theme]);
  const toggleTheme = () => setTheme((previous) => (previous === "light" ? "dark" : "light"));
  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
