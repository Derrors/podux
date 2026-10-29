import React, { useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LanguageContext, type Language } from "./language";

const USER_LANG_KEY = "user-language";

function getBrowserLanguage(): Language {
  const lang = navigator.language || "en";
  return lang.startsWith("zh") ? "zh" : "en";
}

function readUserLanguage(): Language | null {
  try {
    const val = localStorage.getItem(USER_LANG_KEY);
    if (val === "en" || val === "zh") return val;
  } catch {
    // localStorage unavailable: fall back to the browser language.
  }
  return null;
}

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { i18n } = useTranslation();
  const [userLanguage, setUserLanguageState] = useState<Language | null>(readUserLanguage);

  const setUserLanguage = useCallback((lang: Language | null) => {
    setUserLanguageState(lang);
    try {
      if (lang === null) {
        localStorage.removeItem(USER_LANG_KEY);
      } else {
        localStorage.setItem(USER_LANG_KEY, lang);
      }
    } catch {
      // Persisting is best-effort; the in-memory choice still applies.
    }
  }, []);

  const language: Language = userLanguage ?? getBrowserLanguage();

  useEffect(() => {
    i18n.changeLanguage(language);
  }, [language, i18n]);

  const setLanguage = useCallback(
    (lang: Language) => {
      setUserLanguage(lang);
      i18n.changeLanguage(lang);
    },
    [i18n, setUserLanguage]
  );

  // 重置为浏览器默认语言（清除用户的手动设置）
  const resetToDefault = useCallback(() => {
    setUserLanguage(null);
    i18n.changeLanguage(getBrowserLanguage());
  }, [i18n, setUserLanguage]);

  return (
    <LanguageContext.Provider
      value={{
        language,
        isManuallySet: userLanguage !== null,
        setLanguage,
        resetToDefault,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
};
