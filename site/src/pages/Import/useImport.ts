import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { apiPost, getErrorMessage } from "../../lib/api";
import { notifyError } from "../../lib/notify";

export interface ImportServerInfo {
  name: string;
  serverAddr: string;
  serverPort: number;
  auth: Record<string, unknown>;
  log: Record<string, unknown>;
  transport: Record<string, unknown>;
  metadatas: Record<string, string>;
  isDuplicate: boolean;
  existingId: string;
}

export interface ImportProxyInfo {
  name: string;
  type: string;
  localIP: string;
  localPort: number;
  remotePort: number;
  subdomain: string;
  customDomains: string[];
  transport: Record<string, unknown>;
  isDuplicate: boolean;
  existingId: string;
}

export interface ImportVisitorInfo {
  name: string;
  type: string;
  serverName: string;
  bindAddr: string;
  bindPort: number;
  isDuplicate: boolean;
}

export interface ImportPreview {
  server: ImportServerInfo;
  proxies: ImportProxyInfo[];
  visitors?: ImportVisitorInfo[];
  /** Warning codes, e.g. "tls_file_path_ignored"; omitted when empty. */
  warnings?: string[];
}

export interface ProxySelection {
  name: string;
  import: boolean;
  overwrite: boolean;
}

export interface ImportResult {
  serverImported: boolean;
  proxiesImported: number;
  proxiesSkipped: number;
  visitorsImported: number;
  visitorsSkipped: number;
}

export type ImportStep = 1 | 2 | 3;

export function useImport() {
  const { t } = useTranslation();

  const [step, setStep] = useState<ImportStep>(1);
  const [tomlContent, setTomlContent] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [serverName, setServerName] = useState("");
  const [importServer, setImportServer] = useState(true);
  const [overwriteServer, setOverwriteServer] = useState(false);
  const [proxySelections, setProxySelections] = useState<ProxySelection[]>([]);
  // Visitors are imported all together; duplicates (same name on the server) are skipped unless overwriting.
  const [importVisitors, setImportVisitors] = useState(true);
  const [overwriteVisitors, setOverwriteVisitors] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (typeof content === "string") {
        setTomlContent(content);
        setParseError(null);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const handleParse = useCallback(async () => {
    if (!tomlContent.trim()) {
      setParseError(t("import.errorEmptyContent"));
      return;
    }
    setParsing(true);
    setParseError(null);
    try {
      const data = await apiPost<ImportPreview>("/api/import/preview", { tomlContent });
      setPreview(data);
      // Initialize server name from preview
      setServerName(data.server.name);
      // Initialize proxy selections – import all by default
      const selections: ProxySelection[] = (data.proxies as ImportProxyInfo[]).map((p) => ({
        name: p.name,
        import: true,
        overwrite: false,
      }));
      setProxySelections(selections);
      setStep(2);
    } catch (err) {
      setParseError(getErrorMessage(err) || t("import.errorParseFailed"));
    } finally {
      setParsing(false);
    }
  }, [tomlContent, t]);

  const updateProxySelection = useCallback(
    (name: string, field: "import" | "overwrite", value: boolean) => {
      setProxySelections((prev) =>
        prev.map((s) => (s.name === name ? { ...s, [field]: value } : s))
      );
    },
    []
  );

  const selectAllProxies = useCallback((selected: boolean) => {
    setProxySelections((prev) => prev.map((s) => ({ ...s, import: selected })));
  }, []);

  const handleExecute = useCallback(async () => {
    if (!preview) return;
    setImporting(true);
    try {
      const data = await apiPost<{ result: ImportResult }>("/api/import/execute", {
        tomlContent,
        serverName,
        importServer,
        overwriteServer,
        proxies: proxySelections,
        importVisitors,
        overwriteVisitors,
      });
      setResult(data.result);
      setStep(3);
      toast.success(t("import.importSuccess"));
    } catch (err) {
      notifyError(t("import.errorImportFailed"), err);
    } finally {
      setImporting(false);
    }
  }, [preview, tomlContent, serverName, importServer, overwriteServer, proxySelections, importVisitors, overwriteVisitors, t]);

  const handleReset = useCallback(() => {
    setStep(1);
    setTomlContent("");
    setPreview(null);
    setServerName("");
    setImportServer(true);
    setOverwriteServer(false);
    setProxySelections([]);
    setImportVisitors(true);
    setOverwriteVisitors(false);
    setParseError(null);
    setResult(null);
  }, []);

  const goBack = useCallback(() => {
    setStep((prev) => (prev > 1 ? ((prev - 1) as ImportStep) : prev));
  }, []);

  // Derived: count selected proxies
  const selectedProxiesCount = proxySelections.filter((s) => s.import).length;
  const visitorCount = preview?.visitors?.length ?? 0;

  return {
    step,
    tomlContent,
    setTomlContent,
    preview,
    serverName,
    setServerName,
    importServer,
    setImportServer,
    overwriteServer,
    setOverwriteServer,
    proxySelections,
    importVisitors,
    setImportVisitors,
    overwriteVisitors,
    setOverwriteVisitors,
    visitorCount,
    parsing,
    importing,
    parseError,
    result,
    selectedProxiesCount,
    handleFileUpload,
    handleParse,
    updateProxySelection,
    selectAllProxies,
    handleExecute,
    handleReset,
    goBack,
  };
}
