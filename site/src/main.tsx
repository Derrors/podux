import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.radix.css";
import "./index.css";
import "./i18n";
import "./icons";
import { ThemedApp } from "./ThemedApp";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LanguageProvider } from "./contexts/LanguageContext";
import { ErrorBoundary } from "./components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <LanguageProvider>
          <ThemedApp />
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>
);
