import { useState } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import pb from "../../lib/pocketbase";
import { sanitizeRedirect } from "../../lib/auth";
import { getErrorMessage } from "../../lib/api";

export function useLogin() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Page to return to after login: ?redirect=… (set by RequireAuth), then router state, then dashboard.
  const stateFrom = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
  const from =
    sanitizeRedirect(searchParams.get("redirect")) ?? sanitizeRedirect(stateFrom) ?? "/dashboard";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      await pb.collection("fh_users").authWithPassword(email, password);
      // Redirect back to previous page after successful login
      navigate(from, { replace: true });
    } catch (err) {
      setError(getErrorMessage(err) || t("auth.invalidCredentials"));
    } finally {
      setLoading(false);
    }
  };

  return {
    email,
    setEmail,
    password,
    setPassword,
    loading,
    error,
    handleSubmit,
  };
}
