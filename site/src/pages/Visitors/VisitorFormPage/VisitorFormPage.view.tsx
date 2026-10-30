import { Icon } from "@iconify/react/offline";
import { Box, Button, Callout, Flex, Select, Separator, Spinner, Switch, Text, TextArea, TextField } from "@radix-ui/themes";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

import { FormItem } from "../../../components/FormItem";
import { PageHeader } from "../../../components/PageHeader";
import { RadioCardGroup } from "../../../components/RadioCardGroup";
import { SectionHeading } from "../../../components/SectionHeading";
import type { ServerOption } from "../../Proxies/ProxyFormPage/useProxyForm";
import type { FallbackOption, SecretProxyOption, VisitorFormData } from "./useVisitorForm";

const visitorTypes = [
  { value: "stcp", label: "STCP", icon: "lucide:shield" },
  { value: "sudp", label: "SUDP", icon: "lucide:shield-ellipsis" },
  { value: "xtcp", label: "XTCP", icon: "lucide:share-2" },
];

interface VisitorFormPageViewProps {
  isEditing: boolean;
  formData: VisitorFormData;
  servers: ServerOption[];
  secretProxies: SecretProxyOption[];
  fallbacks: FallbackOption[];
  loadingServers: boolean;
  loading: boolean;
  submitting: boolean;
  errors: Partial<Record<keyof VisitorFormData, string>>;
  mounted: boolean;
  onChange: (field: keyof VisitorFormData, value: string | boolean) => void;
  onFillFromProxy: (proxyId: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function VisitorFormPageView({
  isEditing,
  formData,
  servers,
  secretProxies,
  fallbacks,
  loadingServers,
  loading,
  submitting,
  errors,
  mounted,
  onChange,
  onFillFromProxy,
  onSubmit,
  onCancel,
}: VisitorFormPageViewProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <Flex align="center" justify="center" className="min-h-[60vh]">
        <Spinner size="3" />
      </Flex>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-5 overflow-hidden">
      <PageHeader
        title={isEditing ? t("visitor.edit") : t("visitor.add")}
        description={t("visitor.formDescription")}
        visible={mounted}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={mounted ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
        transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
        className="flex-1 min-h-0 overflow-y-auto pr-2"
      >
        <Flex direction="column" gap="8">
          <section>
            <SectionHeading id="section-basic" title={t("proxy.sectionBasic")} icon="lucide:info" />
            <Flex direction="column" gap="4">
              <FormItem label={t("proxy.selectServer")} required error={errors.serverId}>
                <Select.Root
                  value={formData.serverId}
                  onValueChange={(v) => onChange("serverId", v)}
                  disabled={loadingServers || servers.length === 0}
                >
                  <Select.Trigger
                    placeholder={loadingServers ? t("common.loading") : t("proxy.selectServerPlaceholder")}
                    style={{ width: "100%" }}
                  />
                  <Select.Content>
                    {servers.map((s) => (
                      <Select.Item key={s.id} value={s.id}>
                        {s.serverName}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                <Text size="1" color="gray" mt="1" as="p">
                  {t("visitor.serverDesc")}
                </Text>
              </FormItem>

              <FormItem label={t("common.name")} required error={errors.name}>
                <TextField.Root
                  size="2"
                  placeholder={t("visitor.namePlaceholder")}
                  value={formData.name}
                  onChange={(e) => onChange("name", e.target.value)}
                  color={errors.name ? "red" : undefined}
                />
              </FormItem>

              <FormItem label={t("common.type")} required>
                <RadioCardGroup options={visitorTypes} value={formData.type} onChange={(v) => onChange("type", v)} />
              </FormItem>
            </Flex>
          </section>

          <Separator size="4" />

          <section>
            <SectionHeading id="section-target" title={t("visitor.sectionTarget")} icon="lucide:crosshair" />
            <Flex direction="column" gap="4">
              {secretProxies.length > 0 && (
                <FormItem label={t("visitor.fillFromProxy")}>
                  <Select.Root value="" onValueChange={onFillFromProxy}>
                    <Select.Trigger placeholder={t("visitor.fillFromProxyPlaceholder")} style={{ width: "100%" }} />
                    <Select.Content>
                      {secretProxies.map((p) => (
                        <Select.Item key={p.id} value={p.id}>
                          {p.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                  <Text size="1" color="gray" mt="1" as="p">
                    {t("visitor.fillFromProxyDesc")}
                  </Text>
                </FormItem>
              )}

              <FormItem label={t("visitor.serverName")} required error={errors.serverName}>
                <TextField.Root
                  size="2"
                  className="font-mono"
                  placeholder="nas-abc123def456ghi"
                  value={formData.serverName}
                  onChange={(e) => onChange("serverName", e.target.value)}
                  color={errors.serverName ? "red" : undefined}
                />
                <Text size="1" color="gray" mt="1" as="p">
                  {t("visitor.serverNameDesc")}
                </Text>
              </FormItem>

              <FormItem label={t("visitor.serverUser")}>
                <TextField.Root
                  size="2"
                  value={formData.serverUser}
                  onChange={(e) => onChange("serverUser", e.target.value)}
                />
                <Text size="1" color="gray" mt="1" as="p">
                  {t("visitor.serverUserDesc")}
                </Text>
              </FormItem>

              <FormItem label={t("proxy.secretKey")} required error={errors.secretKey}>
                <TextField.Root
                  size="2"
                  className="font-mono"
                  value={formData.secretKey}
                  onChange={(e) => onChange("secretKey", e.target.value)}
                  color={errors.secretKey ? "red" : undefined}
                  autoComplete="off"
                />
                <Text size="1" color="gray" mt="1" as="p">
                  {t("visitor.secretKeyDesc")}
                </Text>
              </FormItem>
            </Flex>
          </section>

          <Separator size="4" />

          <section>
            <SectionHeading id="section-local" title={t("visitor.sectionLocal")} icon="lucide:monitor" />
            <Flex direction="column" gap="4">
              {formData.type === "stcp" && (
                <Flex justify="between" align="center">
                  <Box>
                    <Text size="2" weight="medium">{t("visitor.noBind")}</Text>
                    <Text as="p" size="1" color="gray">{t("visitor.noBindDesc")}</Text>
                  </Box>
                  <Switch checked={formData.noBind} onCheckedChange={(v) => onChange("noBind", v)} />
                </Flex>
              )}
              {!(formData.type === "stcp" && formData.noBind) && (
              <Flex gap="3">
                <Box className="flex-[2]">
                  <FormItem label={t("visitor.bindAddr")} required error={errors.bindAddr}>
                    <TextField.Root
                      size="2"
                      value={formData.bindAddr}
                      onChange={(e) => onChange("bindAddr", e.target.value)}
                      color={errors.bindAddr ? "red" : undefined}
                    />
                  </FormItem>
                </Box>
                <Box className="flex-1">
                  <FormItem label={t("visitor.bindPort")} required error={errors.bindPort}>
                    <TextField.Root
                      size="2"
                      type="number"
                      value={formData.bindPort}
                      onChange={(e) => onChange("bindPort", e.target.value)}
                      color={errors.bindPort ? "red" : undefined}
                    />
                  </FormItem>
                </Box>
              </Flex>
              )}
              <Text size="1" color="gray" as="p">
                {t("visitor.bindDesc")}
              </Text>

              {formData.type === "xtcp" && (
                <Flex justify="between" align="center">
                  <Box>
                    <Text size="2" weight="medium">{t("visitor.keepTunnelOpen")}</Text>
                    <Text as="p" size="1" color="gray">{t("visitor.keepTunnelOpenDesc")}</Text>
                  </Box>
                  <Switch checked={formData.keepTunnelOpen} onCheckedChange={(v) => onChange("keepTunnelOpen", v)} />
                </Flex>
              )}

              {formData.type === "xtcp" && (
                <Flex gap="3" wrap="wrap">
                  <Box className="min-w-[200px] flex-[2]">
                    <FormItem label={t("visitor.fallbackTo")}>
                      <Select.Root
                        value={formData.fallbackTo || "none"}
                        onValueChange={(v) => onChange("fallbackTo", v === "none" ? "" : v)}
                      >
                        <Select.Trigger style={{ width: "100%" }} />
                        <Select.Content>
                          <Select.Item value="none">{t("visitor.fallbackNone")}</Select.Item>
                          {fallbacks.map((f) => (
                            <Select.Item key={f.id} value={f.id}>
                              {f.name}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select.Root>
                    </FormItem>
                  </Box>
                  <Box className="min-w-[140px] flex-1">
                    <FormItem label={t("visitor.fallbackTimeout")} error={errors.fallbackTimeoutMs}>
                      <TextField.Root
                        size="2"
                        type="number"
                        placeholder="1000"
                        disabled={!formData.fallbackTo}
                        value={formData.fallbackTimeoutMs}
                        onChange={(e) => onChange("fallbackTimeoutMs", e.target.value)}
                      />
                    </FormItem>
                  </Box>
                  <Text size="1" color="gray" as="p" className="w-full">
                    {t("visitor.fallbackDesc")}
                  </Text>
                </Flex>
              )}
            </Flex>
          </section>

          <Separator size="4" />

          <section>
            <SectionHeading id="section-transport" title={t("proxy.sectionTransport")} icon="lucide:shield" />
            <Flex direction="column" gap="3">
              <Callout.Root size="1" color="gray" variant="surface">
                <Callout.Text>{t("visitor.transportMatch")}</Callout.Text>
              </Callout.Root>
              <Flex justify="between" align="center">
                <Text size="2" weight="medium">{t("proxy.transportEncryption")}</Text>
                <Switch checked={formData.encryption} onCheckedChange={(v) => onChange("encryption", v)} />
              </Flex>
              <Separator size="4" />
              <Flex justify="between" align="center">
                <Text size="2" weight="medium">{t("proxy.dataCompression")}</Text>
                <Switch checked={formData.compression} onCheckedChange={(v) => onChange("compression", v)} />
              </Flex>
            </Flex>
          </section>

          <Separator size="4" />

          <section>
            <SectionHeading id="section-description" title={t("proxy.descriptionLabel")} icon="lucide:file-text" />
            <TextArea
              size="2"
              maxLength={1000}
              placeholder={t("proxy.descriptionPlaceholder")}
              value={formData.description}
              onChange={(e) => onChange("description", e.target.value)}
              className="min-h-[100px]"
            />
          </section>

          <Flex justify="end" gap="3" pb="6">
            <Button variant="soft" color="gray" size="2" onClick={onCancel}>
              <Icon icon="lucide:arrow-left" width="16" height="16" />
              {t("common.cancel")}
            </Button>
            <Button size="2" disabled={submitting} onClick={onSubmit}>
              {submitting ? <Spinner size="1" /> : <Icon icon={isEditing ? "lucide:pencil" : "lucide:plus"} width="16" height="16" />}
              {isEditing ? t("proxy.saveChanges") : t("visitor.add")}
            </Button>
          </Flex>
        </Flex>
      </motion.div>
    </div>
  );
}
