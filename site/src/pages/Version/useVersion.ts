import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { apiGet, getErrorMessage } from "../../lib/api";

export interface GithubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
  download_url: string;
}

export function useVersion() {
  const { t } = useTranslation();
  const [releases, setReleases] = useState<GithubRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchReleases() {
      try {
        setLoading(true);
        const data = await apiGet<GithubRelease[] | null>("/api/github/frp/releases");
        setReleases(data ?? []);
      } catch (err) {
        setError(getErrorMessage(err) || t("version.fetchFailed"));
      } finally {
        setLoading(false);
      }
    }

    fetchReleases();
  }, [t]);

  return {
    releases,
    loading,
    error,
  };
}
