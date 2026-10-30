import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../../../i18n";
import pb from "../../../lib/pocketbase";
import { apiGet } from "../../../lib/api";
import { notifyError } from "../../../lib/notify";
import { toast } from "sonner";
import { REGEX } from "../../../lib/regex";
import { fieldErrors } from "../../../lib/fieldErrors";
import { isSecretProxyType, type HealthCheck } from "../../../types/proxy";

export interface ProxyFormData {
  serverId: string;
  name: string;
  type: "tcp" | "udp" | "http" | "https" | "tcpmux" | "stcp" | "sudp" | "xtcp";
  localIp: string;
  localPort: string;
  remotePort: string;
  customDomains: string[];
  subdomain: string;
  encryption: boolean;
  compression: boolean;
  description: string;
  pluginEnabled: boolean;
  pluginType: "socks5";
  pluginUsername: string;
  pluginPassword: string;
  /** stcp/sudp/xtcp: key visitors must present, and frp users allowed to visit ("*" = any). */
  secretKey: string;
  allowUsers: string;
  /** Bandwidth limit as a number of `bandwidthUnit`; empty = unlimited. */
  bandwidthLimit: string;
  bandwidthUnit: "KB" | "MB";
  bandwidthMode: "client" | "server";
  healthCheckType: "" | "tcp" | "http";
  healthCheckPath: string;
  healthCheckInterval: string;
  healthCheckTimeout: string;
  healthCheckMaxFailed: string;
}

const DEFAULT_FORM: ProxyFormData = {
  serverId: "",
  name: "",
  type: "tcp",
  localIp: "127.0.0.1",
  localPort: "",
  remotePort: "",
  customDomains: [],
  subdomain: "",
  encryption: false,
  compression: false,
  description: "",
  pluginEnabled: false,
  pluginType: "socks5",
  pluginUsername: "",
  pluginPassword: "",
  secretKey: "",
  allowUsers: "",
  bandwidthLimit: "",
  bandwidthUnit: "MB",
  bandwidthMode: "client",
  healthCheckType: "",
  healthCheckPath: "/",
  healthCheckInterval: "10",
  healthCheckTimeout: "3",
  healthCheckMaxFailed: "1",
};

/** Random hex secret key for stcp/sudp/xtcp proxies. */
export const generateSecretKey = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Splits frp's bandwidth quantity ("1MB", "500KB") into the form's number and unit. */
const parseBandwidth = (value: unknown): Pick<ProxyFormData, "bandwidthLimit" | "bandwidthUnit"> => {
  const m = typeof value === "string" ? /^(\d+)\s*(KB|MB)$/i.exec(value.trim()) : null;
  return m
    ? { bandwidthLimit: m[1], bandwidthUnit: m[2].toUpperCase() as "KB" | "MB" }
    : { bandwidthLimit: "", bandwidthUnit: "MB" };
};

const POSITIVE_INT = /^[1-9][0-9]{0,5}$/;

/** Backend record fields whose validation errors map onto form fields. */
const RECORD_TO_FORM: Record<string, keyof ProxyFormData> = {
  name: "name",
  localIP: "localIp",
  localPort: "localPort",
  remotePort: "remotePort",
  subdomain: "subdomain",
  customDomains: "customDomains",
  secretKey: "secretKey",
};

type Transport = Record<string, unknown>;

/** Reads a flag stored as camelCase (frp, TOML import) or snake_case (older forms). */
const transportFlag = (transport: Transport, key: string, legacyKey: string) =>
  Boolean(transport[key] ?? transport[legacyKey]);

export interface ServerOption {
  id: string;
  serverName: string;
  bootStatus: string;
  networkStatus?: {
    latency: number;
    reachable: boolean;
  };
}

export function useProxyForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const { t } = useTranslation();

  const [formData, setFormData] = useState<ProxyFormData>(DEFAULT_FORM);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingProxy, setLoadingProxy] = useState(isEditing);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof ProxyFormData, string>>>({});
  // Transport keys the form doesn't edit (e.g. bandwidthLimit from a TOML import) are kept on save.
  const loadedTransport = useRef<Transport>({});

  useEffect(() => {
    const fetchServers = async () => {
      try {
        setLoadingServers(true);
        const list = (await apiGet<ServerOption[] | null>("/api/servers/options")) ?? [];
        setServers(list);
        if (list.length > 0 && !isEditing) {
          setFormData((prev) => ({ ...prev, serverId: list[0].id }));
        }
      } catch (err) {
        // i18n singleton, not t: t changes per language and would refetch and reset the form.
        notifyError(i18n.t("server.fetchFailed"), err);
      } finally {
        setLoadingServers(false);
      }
    };
    fetchServers();
  }, [isEditing]);

  useEffect(() => {
    if (!id) return;
    const fetchProxy = async () => {
      try {
        setLoadingProxy(true);
        const record = await pb.collection("fh_proxies").getOne(id);
        const plugin = record.plugin as Record<string, string> | null | undefined;
        const transport = (record.transport as Transport | null | undefined) ?? {};
        const healthCheck = (record.healthCheck as HealthCheck | null | undefined) ?? {};
        loadedTransport.current = transport;
        setFormData({
          serverId: record.serverId as string,
          name: (record.name as string) || "",
          type: record.proxyType as ProxyFormData["type"],
          localIp: (record.localIP as string) || "127.0.0.1",
          localPort: String(record.localPort || ""),
          remotePort: String(record.remotePort || ""),
          subdomain: (record.subdomain as string) || "",
          customDomains: (record.customDomains as string[] | undefined) || [],
          encryption: transportFlag(transport, "useEncryption", "use_encryption"),
          compression: transportFlag(transport, "useCompression", "use_compression"),
          description: (record.description as string) || "",
          pluginEnabled: !!plugin?.type,
          pluginType: (plugin?.type as ProxyFormData["pluginType"]) || "socks5",
          pluginUsername: plugin?.username || "",
          pluginPassword: plugin?.password || "",
          secretKey: (record.secretKey as string) || "",
          allowUsers: ((record.allowUsers as string[] | null) ?? []).join(", "),
          ...parseBandwidth(transport.bandwidthLimit),
          bandwidthMode: transport.bandwidthLimitMode === "server" ? "server" : "client",
          healthCheckType: healthCheck.type || "",
          healthCheckPath: healthCheck.path || "/",
          healthCheckInterval: String(healthCheck.intervalSeconds || 10),
          healthCheckTimeout: String(healthCheck.timeoutSeconds || 3),
          healthCheckMaxFailed: String(healthCheck.maxFailed || 1),
        });
      } catch (err) {
        notifyError(i18n.t("proxy.loadFailed"), err);
        navigate("/proxies");
      } finally {
        setLoadingProxy(false);
      }
    };
    fetchProxy();
  }, [id, navigate]);

  const validateField = (field: keyof ProxyFormData, value: string) => {
    let error = "";
    if (value) {
      switch (field) {
        case "name":
          if (!REGEX.PROXY_NAME.test(value)) error = t("proxy.errorInvalidName");
          break;
        case "localIp":
          if (!REGEX.IP_OR_HOSTNAME.test(value)) error = t("proxy.errorInvalidIP");
          break;
        case "localPort":
        case "remotePort":
          if (!REGEX.PORT.test(value)) error = t("proxy.errorInvalidPort");
          break;
        case "subdomain":
          if (!REGEX.SUBDOMAIN.test(value)) error = t("proxy.errorInvalidSubdomain");
          break;
        case "bandwidthLimit":
        case "healthCheckInterval":
        case "healthCheckTimeout":
        case "healthCheckMaxFailed":
          if (!POSITIVE_INT.test(value)) error = t("proxy.errorPositiveInteger");
          break;
        case "healthCheckPath":
          if (!value.startsWith("/")) error = t("proxy.errorHealthCheckPath");
          break;
      }
    }
    setErrors((prev) => ({ ...prev, [field]: error }));
  };

  const handleChange = (field: keyof ProxyFormData, value: string | boolean | string[]) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "type" && value !== "tcp" && prev.pluginEnabled && prev.pluginType === "socks5") {
        next.pluginEnabled = false;
      }
      // A new stcp/sudp/xtcp proxy starts with a random secret key.
      if (field === "type" && typeof value === "string" && isSecretProxyType(value) && !prev.secretKey) {
        next.secretKey = generateSecretKey();
      }
      return next;
    });
    if (typeof value === "string") validateField(field, value);
    if (Array.isArray(value) && field === "customDomains") {
      setErrors((prev) => ({ ...prev, customDomains: undefined }));
    }
  };

  const validate = (data: ProxyFormData): boolean => {
    const isHttp = data.type === "http" || data.type === "https";
    const isSecret = isSecretProxyType(data.type);
    const isSocks5 = data.pluginEnabled && data.pluginType === "socks5";
    const newErrors: Partial<Record<keyof ProxyFormData, string>> = {};

    if (!data.serverId) newErrors.serverId = t("proxy.errorRequired");
    if (!data.name) newErrors.name = t("proxy.errorRequired");
    else if (!REGEX.PROXY_NAME.test(data.name)) newErrors.name = t("proxy.errorInvalidName");

    if (!isSocks5) {
      if (!data.localIp) newErrors.localIp = t("proxy.errorRequired");
      else if (!REGEX.IP_OR_HOSTNAME.test(data.localIp)) newErrors.localIp = t("proxy.errorInvalidIP");

      if (!data.localPort) newErrors.localPort = t("proxy.errorRequired");
      else if (!REGEX.PORT.test(data.localPort)) newErrors.localPort = t("proxy.errorInvalidPort");
    }

    if (!isHttp && !isSecret && !isSocks5) {
      if (!data.remotePort) newErrors.remotePort = t("proxy.errorRequired");
      else if (!REGEX.PORT.test(data.remotePort)) newErrors.remotePort = t("proxy.errorInvalidPort");
    }

    if (isSecret && !data.secretKey.trim()) newErrors.secretKey = t("proxy.errorRequired");

    if (data.bandwidthLimit && !POSITIVE_INT.test(data.bandwidthLimit)) {
      newErrors.bandwidthLimit = t("proxy.errorPositiveInteger");
    }

    if (data.healthCheckType && !isSocks5) {
      for (const field of ["healthCheckInterval", "healthCheckTimeout", "healthCheckMaxFailed"] as const) {
        if (!POSITIVE_INT.test(data[field])) newErrors[field] = t("proxy.errorPositiveInteger");
      }
      if (data.healthCheckType === "http" && !data.healthCheckPath.startsWith("/")) {
        newErrors.healthCheckPath = t("proxy.errorHealthCheckPath");
      }
    }

    if (isHttp) {
      if (data.subdomain && !REGEX.SUBDOMAIN.test(data.subdomain)) {
        newErrors.subdomain = t("proxy.errorInvalidSubdomain");
      }
      if (data.customDomains.some((d) => !REGEX.DOMAIN.test(d))) {
        newErrors.customDomains = t("proxy.errorInvalidDomain");
      }
      if (!data.subdomain && data.customDomains.length === 0) {
        newErrors.subdomain = t("proxy.errorSubdomainRequired");
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    // Blank rows from "Add custom domain" are dropped rather than saved as "".
    const data = {
      ...formData,
      subdomain: formData.subdomain.trim(),
      customDomains: formData.customDomains.map((d) => d.trim()).filter(Boolean),
    };
    if (!validate(data)) return;

    const plugin = data.pluginEnabled
      ? {
        type: data.pluginType,
        ...(data.pluginUsername ? { username: data.pluginUsername } : {}),
        ...(data.pluginPassword ? { password: data.pluginPassword } : {}),
      }
      : null;

    const isSecret = isSecretProxyType(data.type);
    const isSocks5 = data.pluginEnabled && data.pluginType === "socks5";
    const keptTransport = { ...loadedTransport.current };
    delete keptTransport.use_encryption;
    delete keptTransport.use_compression;
    delete keptTransport.bandwidthLimit;
    delete keptTransport.bandwidthLimitMode;
    if (data.bandwidthLimit) {
      keptTransport.bandwidthLimit = `${data.bandwidthLimit}${data.bandwidthUnit}`;
      if (data.bandwidthMode === "server") keptTransport.bandwidthLimitMode = "server";
    }
    const healthCheck =
      data.healthCheckType && !isSocks5
        ? {
          type: data.healthCheckType,
          ...(data.healthCheckType === "http" ? { path: data.healthCheckPath } : {}),
          intervalSeconds: Number(data.healthCheckInterval),
          timeoutSeconds: Number(data.healthCheckTimeout),
          maxFailed: Number(data.healthCheckMaxFailed),
        }
        : null;
    const allowUsers = data.allowUsers.split(",").map((u) => u.trim()).filter(Boolean);
    // status is left out: an update keeps the proxy enabled or disabled as it was.
    const payload = {
      serverId: data.serverId,
      proxyType: data.type,
      name: data.name,
      localIP: data.localIp,
      localPort: data.localPort,
      // stcp/sudp/xtcp have no public endpoint; clear what a previous type left behind.
      remotePort: isSecret ? "" : data.remotePort,
      subdomain: isSecret ? "" : data.subdomain,
      customDomains: isSecret ? [] : data.customDomains,
      secretKey: isSecret ? data.secretKey.trim() : "",
      allowUsers: isSecret && allowUsers.length > 0 ? allowUsers : null,
      healthCheck,
      transport: {
        ...keptTransport,
        useEncryption: data.encryption,
        useCompression: data.compression,
      },
      plugin,
      description: data.description,
    };

    try {
      setSubmitting(true);
      if (isEditing) {
        await pb.collection("fh_proxies").update(id!, payload);
        toast.success(t("proxy.updateSuccess"));
      } else {
        await pb.collection("fh_proxies").create({ status: "enabled", bootStatus: "offline", ...payload });
        toast.success(t("proxy.createSuccess"));
      }
      navigate("/proxies");
    } catch (err) {
      // Conflicts and other field errors go under their fields; the toast names the first.
      const mapped: Partial<Record<keyof ProxyFormData, string>> = {};
      for (const [field, message] of Object.entries(fieldErrors(err, t))) {
        const formField = RECORD_TO_FORM[field];
        if (formField) mapped[formField] = message;
      }
      const first = Object.values(mapped)[0];
      if (first) {
        setErrors((prev) => ({ ...prev, ...mapped }));
        toast.error(t("proxy.saveFailed"), { description: first });
      } else {
        notifyError(t("proxy.saveFailed"), err);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isHttpType = formData.type === "http" || formData.type === "https";
  const isSecretType = isSecretProxyType(formData.type);
  const isSocks5Plugin = formData.pluginEnabled && formData.pluginType === "socks5";
  // Visitors reach an stcp/sudp/xtcp proxy by the name frpc registers: "<name>-<id>".
  const runtimeName = isEditing && formData.name ? `${formData.name}-${id}` : "";

  const regenerateSecretKey = () => handleChange("secretKey", generateSecretKey());

  return {
    isEditing,
    isSecretType,
    runtimeName,
    regenerateSecretKey,
    formData,
    servers,
    loadingServers,
    loadingProxy,
    submitting,
    errors,
    isHttpType,
    isSocks5Plugin,
    handleChange,
    handleSubmit,
    navigate,
  };
}
