import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "../../../i18n";
import pb from "../../../lib/pocketbase";
import { apiGet } from "../../../lib/api";
import { notifyError } from "../../../lib/notify";
import { toast } from "sonner";
import { REGEX } from "../../../lib/regex";

export interface ServerFormData {
  serverName: string;
  user: string;
  serverAddr: string;
  serverPort: number;
  serverVersion: string;
  description: string;
  autoConnection: boolean;
  auth: {
    method: "none" | "token" | "oidc";
    token: string;
    oidcClientId: string;
    oidcClientSecret: string;
    oidcAudience: string;
    oidcTokenEndpoint: string;
  };
  log: {
    level: "trace" | "debug" | "info" | "warn" | "error";
    maxDays: number;
  };
  transport: {
    protocol: "tcp" | "kcp" | "quic" | "websocket" | "wss";
    tls: {
      enable: boolean;
      disableCustomTLSFirstByte: boolean;
      certFile: string;
      keyFile: string;
      trustedCaFile: string;
      serverName: string;
    };
    proxyURL: string;
  };
  metadatas: Record<string, string>;
}

const defaultData: ServerFormData = {
  serverName: "",
  user: "",
  serverAddr: "",
  serverPort: 7000,
  serverVersion: "built-in",
  description: "",
  autoConnection: false,
  auth: {
    method: "none",
    token: "",
    oidcClientId: "",
    oidcClientSecret: "",
    oidcAudience: "",
    oidcTokenEndpoint: "",
  },
  log: {
    level: "info",
    maxDays: 3,
  },
  transport: {
    protocol: "tcp",
    tls: {
      enable: true,
      disableCustomTLSFirstByte: false,
      certFile: "",
      keyFile: "",
      trustedCaFile: "",
      serverName: "",
    },
    proxyURL: "",
  },
  metadatas: {},
};

export function useServerForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;

  const [formData, setFormData] = useState<ServerFormData>(defaultData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [loadingServer, setLoadingServer] = useState(isEditing);
  const [frpVersion, setFrpVersion] = useState("");

  useEffect(() => {
    // Only used for a label; the form works without it.
    apiGet<{ frp?: string }>("/api/frp/version")
      .then((data) => {
        if (data?.frp) setFrpVersion(data.frp);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoadingServer(true);
    pb.collection("fh_servers")
      .getOne(id)
      .then((record) => {
        setFormData({
          ...defaultData,
          serverName: record.serverName || "",
          user: record.user || "",
          serverAddr: record.serverAddr || "",
          serverPort: record.serverPort || 7000,
          serverVersion: record.serverVersion || "built-in",
          description: record.description || "",
          autoConnection: record.autoConnection || false,
          auth: { ...defaultData.auth, ...(record.auth || {}) },
          log: { ...defaultData.log, ...(record.log || {}) },
          transport: {
            ...defaultData.transport,
            ...(record.transport || {}),
            tls: {
              ...defaultData.transport.tls,
              ...(record.transport?.tls || {}),
            },
          },
          metadatas: record.metadatas || {},
        });
      })
      .catch((err) => {
        // i18n singleton, not t: t changes per language and would refetch and reset the form.
        notifyError(i18n.t("server.failedToLoad"), err);
        navigate("/servers");
      })
      .finally(() => setLoadingServer(false));
  }, [id, navigate]);

  const handleChange = (
    field: keyof Omit<ServerFormData, "auth" | "log" | "transport" | "metadatas">,
    value: string | number | boolean
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error on change, re-validate format
    if (field === "serverName") {
      const error = value && !REGEX.SERVER_NAME.test(value as string) ? t("server.errorInvalidName") : "";
      setErrors((prev) => ({ ...prev, serverName: error }));
    }
    if (field === "serverAddr") {
      const error = value && !REGEX.IP_OR_HOSTNAME.test(value as string) ? t("server.errorInvalidAddr") : "";
      setErrors((prev) => ({ ...prev, serverAddr: error }));
    }
    if (field === "serverPort") {
      const error = value && !REGEX.PORT.test((value as number).toString()) ? t("server.errorInvalidPort") : "";
      setErrors((prev) => ({ ...prev, serverPort: error }));
    }
  };

  const handleAuthChange = (field: keyof ServerFormData["auth"], value: string) => {
    setFormData((prev) => ({ ...prev, auth: { ...prev.auth, [field]: value } }));
  };

  const handleLogChange = (field: keyof ServerFormData["log"], value: string | number) => {
    setFormData((prev) => ({ ...prev, log: { ...prev.log, [field]: value } }));
  };

  const handleTransportChange = (field: keyof ServerFormData["transport"], value: string) => {
    setFormData((prev) => ({ ...prev, transport: { ...prev.transport, [field]: value } }));
  };

  const handleTlsChange = (field: keyof ServerFormData["transport"]["tls"], value: boolean) => {
    setFormData((prev) => ({
      ...prev,
      transport: { ...prev.transport, tls: { ...prev.transport.tls, [field]: value } },
    }));
  };

  const handleTlsStringChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      transport: { ...prev.transport, tls: { ...prev.transport.tls, [field]: value } },
    }));
  };

  const handleFileUpload = (field: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (typeof content === "string") handleTlsStringChange(field, content);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const validate = (data: ServerFormData): boolean => {
    const newErrors: Record<string, string> = {};
    if (!data.serverName) newErrors.serverName = t("server.errorRequired");
    else if (!REGEX.SERVER_NAME.test(data.serverName)) newErrors.serverName = t("server.errorInvalidName");
    if (!data.serverAddr) newErrors.serverAddr = t("server.errorRequired");
    else if (!REGEX.IP_OR_HOSTNAME.test(data.serverAddr)) newErrors.serverAddr = t("server.errorInvalidAddr");
    if (!data.serverPort) newErrors.serverPort = t("server.errorRequired");
    else if (!REGEX.PORT.test(data.serverPort.toString())) newErrors.serverPort = t("server.errorInvalidPort");
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate(formData)) return;

    try {
      setSubmitting(true);
      const payload = { ...formData, serverPort: Number(formData.serverPort) };
      if (isEditing) {
        await pb.collection("fh_servers").update(id!, payload);
        toast.success(t("server.updateSuccess"));
      } else {
        await pb.collection("fh_servers").create({ ...payload, bootStatus: "stopped" });
        toast.success(t("server.createSuccess"));
      }
      navigate("/servers");
    } catch (err) {
      notifyError(t("server.saveFailed"), err);
    } finally {
      setSubmitting(false);
    }
  };

  return {
    isEditing,
    formData,
    errors,
    submitting,
    loadingServer,
    frpVersion,
    handleChange,
    handleAuthChange,
    handleLogChange,
    handleTransportChange,
    handleTlsChange,
    handleTlsStringChange,
    handleFileUpload,
    handleSubmit,
    navigate,
    setFormData,
  };
}
