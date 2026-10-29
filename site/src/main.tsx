import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@radix-ui/themes/styles.css";
import "./index.css";
import "./i18n";
import "./icons";
import { ThemedApp } from "./ThemedApp";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LanguageProvider } from "./contexts/LanguageContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <ThemedApp />
      </LanguageProvider>
    </ThemeProvider>
  </StrictMode>
);
