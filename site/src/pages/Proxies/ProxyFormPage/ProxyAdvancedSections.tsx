import { Icon } from "@iconify/react/offline";
import { Box, Button, Flex, Select, Separator, Switch, Text, TextArea, TextField } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";

import { FormItem } from "../../../components/FormItem";
import { RadioCardGroup } from "../../../components/RadioCardGroup";
import { SectionHeading } from "../../../components/SectionHeading";
import {
  EXPIRY_CHOICES,
  PLUGIN_SPECS,
  PLUGIN_TYPES,
  msUntil,
  optionSupport,
  type ExpiryChoice,
  type HeaderRow,
  type OptionFields,
  type PluginState,
  type PluginType,
} from "./proxyOptions";

const PLUGIN_META: Record<PluginType, { label: string; icon: string }> = {
  socks5: { label: "SOCKS5", icon: "lucide:globe" },
  http_proxy: { label: "HTTP Proxy", icon: "lucide:waypoints" },
  static_file: { label: "Static File", icon: "lucide:folder-open" },
  unix_domain_socket: { label: "Unix Socket", icon: "lucide:cable" },
  http2http: { label: "HTTP2HTTP", icon: "lucide:arrow-right-left" },
  http2https: { label: "HTTP2HTTPS", icon: "lucide:lock" },
  https2http: { label: "HTTPS2HTTP", icon: "lucide:lock-open" },
  https2https: { label: "HTTPS2HTTPS", icon: "lucide:shield-check" },
  tls2raw: { label: "TLS2Raw", icon: "lucide:zap" },
};

/** Editable list of strings with add/remove buttons. */
function StringList({ values, placeholder, addLabel, onChange }: {
  values: string[];
  placeholder: string;
  addLabel: string;
  onChange: (values: string[]) => void;
}) {
  return (
    <Flex direction="column" gap="2">
      {values.map((v, i) => (
        <Flex key={i} gap="2" align="center">
          <TextField.Root
            size="2"
            style={{ flex: 1 }}
            placeholder={placeholder}
            value={v}
            onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <Button type="button" size="2" variant="soft" color="red" onClick={() => onChange(values.filter((_, j) => j !== i))}>
            <Icon icon="lucide:x" />
          </Button>
        </Flex>
      ))}
      <Button type="button" size="2" variant="soft" onClick={() => onChange([...values, ""])}>
        <Icon icon="lucide:plus" />
        {addLabel}
      </Button>
    </Flex>
  );
}

/** Editable list of header name/value pairs. */
function HeaderList({ rows, addLabel, onChange }: { rows: HeaderRow[]; addLabel: string; onChange: (rows: HeaderRow[]) => void }) {
  const { t } = useTranslation();
  return (
    <Flex direction="column" gap="2">
      {rows.map((r, i) => (
        <Flex key={i} gap="2" align="center">
          <TextField.Root
            size="2"
            style={{ flex: 1 }}
            placeholder={t("proxy.headerName")}
            value={r.key}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
          />
          <TextField.Root
            size="2"
            style={{ flex: 2 }}
            placeholder={t("proxy.headerValue")}
            value={r.value}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
          />
          <Button type="button" size="2" variant="soft" color="red" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Icon icon="lucide:x" />
          </Button>
        </Flex>
      ))}
      <Button type="button" size="2" variant="soft" onClick={() => onChange([...rows, { key: "", value: "" }])}>
        <Icon icon="lucide:plus" />
        {addLabel}
      </Button>
    </Flex>
  );
}

/** HTTP auth, routing and header rewriting (http), and HTTP CONNECT auth (tcpmux). */
export function HttpOptionsSection({ type, options, error, onChange }: {
  type: string;
  options: OptionFields;
  error?: string;
  onChange: (patch: Partial<OptionFields>) => void;
}) {
  const { t } = useTranslation();
  const support = optionSupport(type);
  if (!support.auth) return null;
  return (
    <>
      <Separator size="4" />
      <section>
        <SectionHeading id="section-http" title={t("proxy.sectionHttp")} icon="lucide:globe-lock" />
        <Flex direction="column" gap="4">
          <Flex gap="3" wrap="wrap">
            <Box className="min-w-[200px] flex-1">
              <FormItem label={t("proxy.httpUser")}>
                <TextField.Root size="2" value={options.httpUser} autoComplete="off" onChange={(e) => onChange({ httpUser: e.target.value })} />
              </FormItem>
            </Box>
            <Box className="min-w-[200px] flex-1">
              <FormItem label={t("proxy.httpPassword")}>
                <TextField.Root size="2" type="password" autoComplete="new-password" value={options.httpPassword} onChange={(e) => onChange({ httpPassword: e.target.value })} />
              </FormItem>
            </Box>
          </Flex>
          <Text size="1" color="gray" as="p" style={{ marginTop: -8 }}>
            {type === "tcpmux" ? t("proxy.httpAuthTcpmuxDesc") : t("proxy.httpAuthDesc")}
          </Text>
          <FormItem label={t("proxy.routeByHTTPUser")}>
            <TextField.Root size="2" value={options.routeByHTTPUser} onChange={(e) => onChange({ routeByHTTPUser: e.target.value })} />
            <Text size="1" color="gray" mt="1" as="p">{t("proxy.routeByHTTPUserDesc")}</Text>
          </FormItem>
          {support.http && (
            <>
              <FormItem label={t("proxy.hostHeaderRewrite")}>
                <TextField.Root size="2" placeholder="internal.example.lan" value={options.hostHeaderRewrite} onChange={(e) => onChange({ hostHeaderRewrite: e.target.value })} />
                <Text size="1" color="gray" mt="1" as="p">{t("proxy.hostHeaderRewriteDesc")}</Text>
              </FormItem>
              <FormItem label={t("proxy.locations")} error={error}>
                <StringList values={options.locations} placeholder="/api" addLabel={t("proxy.addLocation")} onChange={(locations) => onChange({ locations })} />
                <Text size="1" color="gray" mt="1" as="p">{t("proxy.locationsDesc")}</Text>
              </FormItem>
              <FormItem label={t("proxy.requestHeaders")}>
                <HeaderList rows={options.requestHeaders} addLabel={t("proxy.addHeader")} onChange={(requestHeaders) => onChange({ requestHeaders })} />
              </FormItem>
              <FormItem label={t("proxy.responseHeaders")}>
                <HeaderList rows={options.responseHeaders} addLabel={t("proxy.addHeader")} onChange={(responseHeaders) => onChange({ responseHeaders })} />
              </FormItem>
            </>
          )}
        </Flex>
      </section>
    </>
  );
}

/** frps load balancing group (tcp, http, tcpmux). */
export function LoadBalancerSection({ type, options, onChange }: {
  type: string;
  options: OptionFields;
  onChange: (patch: Partial<OptionFields>) => void;
}) {
  const { t } = useTranslation();
  if (!optionSupport(type).loadBalancer) return null;
  return (
    <>
      <Separator size="4" />
      <section>
        <SectionHeading id="section-lb" title={t("proxy.sectionLoadBalancer")} icon="lucide:split" />
        <Flex direction="column" gap="2">
          <Flex gap="3" wrap="wrap">
            <Box className="min-w-[200px] flex-1">
              <FormItem label={t("proxy.lbGroup")}>
                <TextField.Root size="2" value={options.lbGroup} onChange={(e) => onChange({ lbGroup: e.target.value })} />
              </FormItem>
            </Box>
            <Box className="min-w-[200px] flex-1">
              <FormItem label={t("proxy.lbGroupKey")}>
                <TextField.Root size="2" type="password" autoComplete="off" value={options.lbGroupKey} disabled={!options.lbGroup} onChange={(e) => onChange({ lbGroupKey: e.target.value })} />
              </FormItem>
            </Box>
          </Flex>
          <Text size="1" color="gray" as="p">{t("proxy.lbDesc")}</Text>
        </Flex>
      </section>
    </>
  );
}

/** Plugin switch, type and the chosen plugin's fields. */
export function PluginSection({ type, plugin, error, onChange }: {
  type: string;
  plugin: PluginState;
  error?: string;
  onChange: (patch: Partial<PluginState>) => void;
}) {
  const { t } = useTranslation();
  const spec = PLUGIN_SPECS[plugin.type];
  const supported = PLUGIN_TYPES.filter((p) => PLUGIN_SPECS[p].proxyTypes.includes(type));
  return (
    <section>
      <SectionHeading id="section-plugin" title={t("proxy.sectionPlugin")} icon="lucide:puzzle" />
      <Flex direction="column" gap="4">
        <Flex justify="between" align="center">
          <Box>
            <Text size="2" weight="medium">{t("proxy.pluginEnable")}</Text>
            <Text as="p" size="1" color="gray">{t("proxy.pluginEnableDesc")}</Text>
          </Box>
          <Switch
            size="2"
            checked={plugin.enabled}
            disabled={supported.length === 0}
            onCheckedChange={(v) => onChange(v && !supported.includes(plugin.type) ? { enabled: true, type: supported[0] } : { enabled: v })}
          />
        </Flex>
        {plugin.enabled && (
          <Flex direction="column" gap="4" className="border-l-2 border-[var(--accent-6)] pl-4">
            <FormItem label={t("proxy.pluginType")} required error={error}>
              <RadioCardGroup
                options={[
                  ...PLUGIN_TYPES.map((p) => ({
                    value: p,
                    label: PLUGIN_META[p].label,
                    icon: PLUGIN_META[p].icon,
                    incompatible: !PLUGIN_SPECS[p].proxyTypes.includes(type),
                    incompatibleLabel: t("proxy.pluginUnsupportedType"),
                  })),
                  { value: "virtual_net", label: "VirtualNet", icon: "lucide:network", comingSoon: true },
                ]}
                value={plugin.type}
                onChange={(v) => onChange({ type: v as PluginType })}
                comingSoonLabel={t("common.comingSoon")}
              />
              <Text size="1" color="gray" mt="1" as="p">{t(`proxy.pluginDesc.${plugin.type}`)}</Text>
            </FormItem>
            {spec.fields.map((f) => (
              <FormItem key={f.key} label={t(`proxy.pluginField.${f.key}`)} required={f.required}>
                {f.pem ? (
                  <TextArea
                    size="2"
                    className="min-h-[72px] font-mono"
                    placeholder={t("proxy.pluginPemPlaceholder")}
                    value={plugin.fields[f.key] ?? ""}
                    onChange={(e) => onChange({ fields: { ...plugin.fields, [f.key]: e.target.value } })}
                  />
                ) : (
                  <TextField.Root
                    size="2"
                    type={f.secret ? "password" : "text"}
                    autoComplete={f.secret ? "new-password" : "off"}
                    placeholder={f.placeholder}
                    value={plugin.fields[f.key] ?? ""}
                    onChange={(e) => onChange({ fields: { ...plugin.fields, [f.key]: e.target.value } })}
                  />
                )}
              </FormItem>
            ))}
            {spec.fields.some((f) => f.pem) && (
              <Text size="1" color="gray" as="p">{t("proxy.pluginPemDesc")}</Text>
            )}
          </Flex>
        )}
      </Flex>
    </section>
  );
}

/** Expiry of a temporary proxy. */
export function ExpirySection({ choice, custom, expiresAt, error, onChange }: {
  choice: ExpiryChoice;
  custom: string;
  expiresAt: string;
  error?: string;
  onChange: (field: "expiryChoice" | "expiryCustom", value: string) => void;
}) {
  const { t } = useTranslation();
  const left = msUntil(expiresAt);
  return (
    <section>
      <SectionHeading id="section-expiry" title={t("proxy.sectionExpiry")} icon="lucide:timer" />
      <Flex direction="column" gap="3">
        <FormItem label={t("proxy.expiry")} error={error}>
          <Flex gap="2" wrap="wrap">
            <Select.Root value={choice} onValueChange={(v) => onChange("expiryChoice", v)}>
              <Select.Trigger style={{ minWidth: 200 }} />
              <Select.Content>
                {EXPIRY_CHOICES.filter((c) => c !== "keep" || expiresAt).map((c) => (
                  <Select.Item key={c} value={c}>
                    {t(`proxy.expiryChoice.${c}`)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            {choice === "custom" && (
              <TextField.Root type="datetime-local" value={custom} onChange={(e) => onChange("expiryCustom", e.target.value)} />
            )}
          </Flex>
        </FormItem>
        {choice === "keep" && left !== null && (
          <Text size="1" color="gray">
            {t("proxy.expiresAtCurrent", { time: new Date(expiresAt.replace(" ", "T")).toLocaleString() })}
          </Text>
        )}
        <Text size="1" color="gray" as="p">{t("proxy.expiryDesc")}</Text>
      </Flex>
    </section>
  );
}
