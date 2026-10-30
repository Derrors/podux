import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import i18n from "../../../i18n";
import pb from "../../../lib/pocketbase";
import { apiGet } from "../../../lib/api";
import { notifyError } from "../../../lib/notify";
import { fieldErrors } from "../../../lib/fieldErrors";
import { REGEX } from "../../../lib/regex";
import { SECRET_PROXY_TYPES, proxyRuntimeName, type Proxy } from "../../../types/proxy";
import type { Visitor } from "../../../types/visitor";
import type { ServerOption } from "../../Proxies/ProxyFormPage/useProxyForm";

export interface VisitorFormData {
  serverId: string;
  name: string;
  type: Visitor["visitorType"];
  serverName: string;
  serverUser: string;
  secretKey: string;
  bindAddr: string;
  bindPort: string;
  keepTunnelOpen: boolean;
  /** stcp only: don't listen; the visitor only serves as an xtcp visitor's fallback. */
  noBind: boolean;
  /** xtcp only: ID of the stcp visitor to fall back to when p2p fails. */
  fallbackTo: string;
  fallbackTimeoutMs: string;
  encryption: boolean;
  compression: boolean;
  description: string;
}

const DEFAULT_FORM: VisitorFormData = {
  serverId: "",
  name: "",
  type: "stcp",
  serverName: "",
  serverUser: "",
  secretKey: "",
  bindAddr: "127.0.0.1",
  bindPort: "",
  keepTunnelOpen: false,
  noBind: false,
  fallbackTo: "",
  fallbackTimeoutMs: "",
  encryption: false,
  compression: false,
  description: "",
};

/** stcp/sudp/xtcp proxies managed by Podux that a visitor can be filled from. */
export interface SecretProxyOption {
  id: string;
  label: string;
  serverId: string;
  type: Visitor["visitorType"];
  runtimeName: string;
  secretKey: string;
}

const RECORD_TO_FORM: Record<string, keyof VisitorFormData> = {
  name: "name",
  serverName: "serverName",
  bindAddr: "bindAddr",
  bindPort: "bindPort",
  secretKey: "secretKey",
  fallbackTo: "fallbackTo",
};

/** An stcp visitor an xtcp visitor can fall back to. */
export interface FallbackOption {
  id: string;
  name: string;
  serverId: string;
}

type Errors = Partial<Record<keyof VisitorFormData, string>>;

export function useVisitorForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const { t } = useTranslation();

  const [formData, setFormData] = useState<VisitorFormData>(DEFAULT_FORM);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [secretProxies, setSecretProxies] = useState<SecretProxyOption[]>([]);
  const [fallbacks, setFallbacks] = useState<FallbackOption[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loading, setLoading] = useState(isEditing);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  // Transport keys the form doesn't edit are kept on save.
  const loadedTransport = useRef<Record<string, unknown>>({});

  useEffect(() => {
    const load = async () => {
      try {
        setLoadingServers(true);
        const [list, proxies, stcpVisitors] = await Promise.all([
          apiGet<ServerOption[] | null>("/api/servers/options"),
          pb.collection("fh_proxies").getFullList<Proxy>({
            filter: SECRET_PROXY_TYPES.map((type) => `proxyType = "${type}"`).join(" || "),
            expand: "serverId",
            sort: "name",
          }),
          pb.collection("fh_visitors").getFullList<Visitor>({ filter: 'visitorType = "stcp"', sort: "name" }),
        ]);
        setFallbacks(stcpVisitors.map((v) => ({ id: v.id, name: v.name, serverId: v.serverId })));
        setServers(list ?? []);
        if (list && list.length > 0 && !isEditing) {
          setFormData((prev) => ({ ...prev, serverId: prev.serverId || list[0].id }));
        }
        setSecretProxies(
          proxies.map((p) => ({
            id: p.id,
            label: `${p.name} (${p.proxyType.toUpperCase()} · ${p.expand?.serverId?.serverName ?? "-"})`,
            serverId: p.serverId,
            type: p.proxyType as Visitor["visitorType"],
            runtimeName: proxyRuntimeName(p),
            secretKey: p.secretKey ?? "",
          }))
        );
      } catch (err) {
        // i18n singleton, not t: t changes per language and would refetch and reset the form.
        notifyError(i18n.t("server.fetchFailed"), err);
      } finally {
        setLoadingServers(false);
      }
    };
    load();
  }, [isEditing]);

  useEffect(() => {
    if (!id) return;
    const fetchVisitor = async () => {
      try {
        setLoading(true);
        const v = await pb.collection("fh_visitors").getOne<Visitor>(id);
        const transport = v.transport ?? {};
        loadedTransport.current = transport;
        setFormData({
          serverId: v.serverId,
          name: v.name,
          type: v.visitorType,
          serverName: v.serverName,
          serverUser: v.serverUser ?? "",
          secretKey: v.secretKey ?? "",
          bindAddr: v.bindAddr || "127.0.0.1",
          bindPort: v.bindPort && v.bindPort > 0 ? String(v.bindPort) : "",
          keepTunnelOpen: !!v.keepTunnelOpen,
          noBind: v.visitorType === "stcp" && (v.bindPort ?? 0) < 0,
          fallbackTo: v.fallbackTo ?? "",
          fallbackTimeoutMs: v.fallbackTimeoutMs ? String(v.fallbackTimeoutMs) : "",
          encryption: Boolean(transport.useEncryption),
          compression: Boolean(transport.useCompression),
          description: v.description ?? "",
        });
      } catch (err) {
        notifyError(i18n.t("visitor.loadFailed"), err);
        navigate("/visitors");
      } finally {
        setLoading(false);
      }
    };
    fetchVisitor();
  }, [id, navigate]);

  const validate = (data: VisitorFormData): boolean => {
    const next: Errors = {};
    if (!data.serverId) next.serverId = t("proxy.errorRequired");
    if (!data.name) next.name = t("proxy.errorRequired");
    else if (!REGEX.PROXY_NAME.test(data.name)) next.name = t("proxy.errorInvalidName");
    if (!data.serverName.trim()) next.serverName = t("proxy.errorRequired");
    if (!data.secretKey.trim()) next.secretKey = t("proxy.errorRequired");
    if (!data.bindAddr) next.bindAddr = t("proxy.errorRequired");
    else if (!REGEX.IP_OR_HOSTNAME.test(data.bindAddr)) next.bindAddr = t("proxy.errorInvalidIP");
    const noBind = data.noBind && data.type === "stcp";
    if (!noBind) {
      if (!data.bindPort) next.bindPort = t("proxy.errorRequired");
      else if (!REGEX.PORT.test(data.bindPort)) next.bindPort = t("proxy.errorInvalidPort");
    }
    if (data.fallbackTimeoutMs && !/^[1-9][0-9]{0,5}$/.test(data.fallbackTimeoutMs)) {
      next.fallbackTimeoutMs = t("proxy.errorPositiveInteger");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleChange = (field: keyof VisitorFormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  /** Fills the target, key, type and server from a proxy managed by Podux. */
  const fillFromProxy = (proxyId: string) => {
    const p = secretProxies.find((o) => o.id === proxyId);
    if (!p) return;
    setFormData((prev) => ({
      ...prev,
      serverId: p.serverId,
      type: p.type,
      serverName: p.runtimeName,
      serverUser: "",
      secretKey: p.secretKey,
    }));
    setErrors({});
  };

  const handleSubmit = async () => {
    const data = { ...formData, serverName: formData.serverName.trim(), secretKey: formData.secretKey.trim() };
    if (!validate(data)) return;

    const payload = {
      serverId: data.serverId,
      name: data.name,
      visitorType: data.type,
      serverName: data.serverName,
      serverUser: data.serverUser.trim(),
      secretKey: data.secretKey,
      bindAddr: data.bindAddr,
      bindPort: data.noBind && data.type === "stcp" ? -1 : Number(data.bindPort),
      keepTunnelOpen: data.type === "xtcp" && data.keepTunnelOpen,
      fallbackTo: data.type === "xtcp" ? data.fallbackTo : "",
      fallbackTimeoutMs: data.type === "xtcp" && data.fallbackTo ? Number(data.fallbackTimeoutMs || 0) : 0,
      transport: { ...loadedTransport.current, useEncryption: data.encryption, useCompression: data.compression },
      description: data.description,
    };

    try {
      setSubmitting(true);
      if (isEditing) {
        await pb.collection("fh_visitors").update(id!, payload);
        toast.success(t("visitor.updateSuccess"));
      } else {
        await pb.collection("fh_visitors").create({ status: "enabled", ...payload });
        toast.success(t("visitor.createSuccess"));
      }
      navigate("/visitors");
    } catch (err) {
      const mapped: Errors = {};
      for (const [field, message] of Object.entries(fieldErrors(err, t))) {
        const formField = RECORD_TO_FORM[field];
        if (formField) mapped[formField] = message;
      }
      const first = Object.values(mapped)[0];
      if (first) {
        setErrors((prev) => ({ ...prev, ...mapped }));
        toast.error(t("visitor.saveFailed"), { description: first });
      } else {
        notifyError(t("visitor.saveFailed"), err);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return {
    isEditing,
    formData,
    servers,
    secretProxies,
    // Fallbacks must be stcp visitors of the same server, and not this visitor.
    fallbacks: fallbacks.filter((f) => f.serverId === formData.serverId && f.id !== id),
    loadingServers,
    loading,
    submitting,
    errors,
    handleChange,
    fillFromProxy,
    handleSubmit,
    navigate,
  };
}
