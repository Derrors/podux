import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useSystemStore } from "../../stores/systemStore";
import { apiPost, getErrorMessage } from "../../lib/api";
import { useLanguage, type Language } from "../../contexts/language";

export function useSetup() {
  const { t } = useTranslation();
  // The shared language context persists the choice under the same key the rest of the app reads.
  const { language, setLanguage } = useLanguage();
  const navigate = useNavigate();
  const checkInitialized = useSystemStore((s) => s.checkInitialized);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkInitialized()
      .then((initialized) => {
        if (initialized) {
          navigate("/", { replace: true });
        } else {
          setChecking(false);
        }
      })
      .catch(() => {
        // Backend unreachable: show the form; submitting will surface the error.
        setChecking(false);
      });
  }, [checkInitialized, navigate]);

  const handleLanguageChange = (lang: Language) => setLanguage(lang);

  const validateForm = () => {
    if (!email || !password || !confirmPassword) {
      setError(t("setup.error.allFieldsRequired"));
      return false;
    }

    if (password.length < 8) {
      setError(t("setup.error.passwordTooShort"));
      return false;
    }

    if (password !== confirmPassword) {
      setError(t("setup.error.passwordMismatch"));
      return false;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError(t("setup.error.invalidEmail"));
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      // Call backend API to initialize system (creates admin user and settings in transaction)
      await apiPost("/api/system/initialize", {
        email: email,
        password: password,
        language: language,
      });

      toast.success(t("setup.success"));

      // Redirect to login page
      setTimeout(() => {
        navigate("/login");
      }, 1500);
    } catch (err) {
      setError(getErrorMessage(err) || t("setup.error.setupFailed"));
    } finally {
      setLoading(false);
    }
  };

  return {
    email,
    setEmail,
    password,
    setPassword,
    confirmPassword,
    setConfirmPassword,
    language,
    handleLanguageChange,
    loading,
    error,
    handleSubmit,
    checking,
  };
}
