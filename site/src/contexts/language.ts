import { createContext, useContext } from "react";

export type Language = "en" | "zh";

export interface LanguageContextType {
  language: Language;
  isManuallySet: boolean;
  setLanguage: (lang: Language) => void;
  resetToDefault: () => void;
}

export const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
};
