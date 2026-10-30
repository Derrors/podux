import { Icon } from "@iconify/react/offline";
import {
  Button,
  Flex,
  Text,
  TextField,
  Box,
  Separator,
  Switch,
  TextArea,
  Select,
  Callout,
  Spinner,
} from "@radix-ui/themes";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useRef } from "react";

import { FormItem } from "../../../components/FormItem";
import { CopyableText } from "../../../components/CopyableText";
import { PageHeader } from "../../../components/PageHeader";
import { SectionHeading } from "../../../components/SectionHeading";
import { RadioCardGroup } from "../../../components/RadioCardGroup";
import { ServerLatency } from "../../../components/ServerLatency";
import { type ProxyFormData, type ServerOption } from "./useProxyForm";
import { ExpirySection, HttpOptionsSection, LoadBalancerSection, PluginSection } from "./ProxyAdvancedSections";
import type { OptionFields, PluginState } from "./proxyOptions";

const proxyTypes = [
  { value: "tcp",    label: "TCP",    icon: "lucide:arrow-right-left", comingSoon: false },
  { value: "udp",    label: "UDP",    icon: "lucide:radio",            comingSoon: false },
  { value: "http",   label: "HTTP",   icon: "lucide:globe",            comingSoon: false },
  { value: "https",  label: "HTTPS",  icon: "lucide:lock",             comingSoon: false },
  { value: "tcpmux", label: "TCPMUX", icon: "lucide:split",            comingSoon: false },
  { value: "stcp",   label: "STCP",   icon: "lucide:shield",           comingSoon: false },
  { value: "sudp",   label: "SUDP",   icon: "lucide:shield-ellipsis",  comingSoon: false },
  { value: "xtcp",   label: "XTCP",   icon: "lucide:share-2",          comingSoon: false },
];



interface ProxyFormPageViewProps {
  isEditing: boolean;
  formData: ProxyFormData;
  servers: ServerOption[];
  loadingServers: boolean;
  loadingProxy: boolean;
  submitting: boolean;
  errors: Partial<Record<keyof ProxyFormData, string>>;
  isHttpType: boolean;
  isSecretType: boolean;
  usesPlugin: boolean;
  /** "<name>-<id>" of a saved stcp/sudp/xtcp proxy, for visitors; empty when new. */
  runtimeName: string;
  mounted: boolean;
  onRegenerateSecretKey: () => void;
  onOptionsChange: (patch: Partial<OptionFields>) => void;
  onPluginChange: (patch: Partial<PluginState>) => void;
  onChange: (field: keyof ProxyFormData, value: string | boolean | string[]) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onNavigateToServers: () => void;
}

export function ProxyFormPageView({
  isEditing,
  formData,
  servers,
  loadingServers,
  loadingProxy,
  submitting,
  errors,
  isHttpType,
  isSecretType,
  usesPlugin,
  runtimeName,
  mounted,
  onRegenerateSecretKey,
  onOptionsChange,
  onPluginChange,
  onChange,
  onSubmit,
  onCancel,
  onNavigateToServers,
}: ProxyFormPageViewProps) {
  const { t } = useTranslation();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  if (loadingProxy) {
    return (
      <Flex align="center" justify="center" className="min-h-[60vh]">
        <Spinner size="3" />
      </Flex>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-5 overflow-hidden">
      <PageHeader
        title={isEditing ? t("proxy.editProxy") : t("proxy.addProxy")}
        description={isEditing ? t("proxy.updateProxyDesc") : t("proxy.addProxyDesc")}
        visible={mounted}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={mounted ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
        transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
        className="flex-1 min-h-0 flex overflow-hidden"
      >
        <div className="flex-1 min-h-0 flex gap-8">
          {/* form */}
          <div
            ref={scrollContainerRef}
            className="flex-1 min-w-0 min-h-0 overflow-y-auto pr-2"
          >
            <Flex direction="column" gap="8">
              <section>
                <SectionHeading id="section-basic" title={t("proxy.sectionBasic")} icon="lucide:info" />
                <Flex direction="column" gap="4">
                  <FormItem label={t("proxy.selectServer")} required>
                    <Select.Root
                      value={formData.serverId}
                      onValueChange={(v) => onChange("serverId", v)}
                      disabled={loadingServers || servers.length === 0}
                    >
                      <Select.Trigger
                        placeholder={
                          loadingServers
                            ? t("common.loading")
                            : servers.length === 0
                              ? t("proxy.noServersAvailable")
                              : t("proxy.selectServerPlaceholder")
                        }
                        style={{ width: "100%" }}
                      />
                      <Select.Content>
                        {servers.map((s) => (
                          <Select.Item key={s.id} value={s.id}>
                            <Flex align="center" gap="2">
                              <span
                                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                                  s.bootStatus === "running" ? "bg-[var(--green-9)]" : "bg-[var(--gray-7)]"
                                }`}
                              />
                              <Text size="2">{s.serverName}</Text>
                              <ServerLatency networkStatus={s.networkStatus} size="1" />
                            </Flex>
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                    {servers.length === 0 && !loadingServers && (
                      <Callout.Root size="1" color="orange" mt="2">
                        <Callout.Icon>
                          <Icon icon="lucide:triangle-alert" width="14" height="14" />
                        </Callout.Icon>
                        <Callout.Text>
                          <Flex align="center" justify="between" gap="2">
                            <Text size="1">{t("proxy.noServersAvailable")}</Text>
                            <Button
                              size="1"
                              variant="ghost"
                              color="orange"
                              className="cursor-pointer shrink-0"
                              onClick={onNavigateToServers}
                            >
                              {t("proxy.goAddServer")}
                              <Icon icon="lucide:arrow-right" width="12" height="12" />
                            </Button>
                          </Flex>
                        </Callout.Text>
                      </Callout.Root>
                    )}
                  </FormItem>

                  <FormItem label={t("proxy.proxyName")} required error={errors.name}>
                    <TextField.Root
                      size="2"
                      placeholder={t("proxy.proxyNamePlaceholder")}
                      value={formData.name}
                      onChange={(e) => onChange("name", e.target.value)}
                      color={errors.name ? "red" : undefined}
                    />
                  </FormItem>

                  <FormItem label={t("proxy.proxyType")} required>
                    <RadioCardGroup
                      options={proxyTypes}
                      value={formData.type}
                      onChange={(v) => onChange("type", v as ProxyFormData["type"])}
                      comingSoonLabel={t("common.comingSoon")}
                    />
                  </FormItem>
                </Flex>
              </section>

              <Separator size="4" />

              {/* 网络配置 */}
              <section>
                <SectionHeading id="section-network" title={t("proxy.sectionNetwork")} icon="lucide:network" />
                <Flex direction="column" gap="4">
                  <AnimatePresence>
                    {!usesPlugin && (
                      <motion.div
                        key="local-addr"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                        style={{ overflow: "hidden" }}
                      >
                        <Flex gap="3">
                          <Box className="flex-[2]">
                            <FormItem label={t("proxy.localAddress")} required error={errors.localIp}>
                              <TextField.Root
                                size="2"
                                placeholder={t("proxy.localAddressPlaceholder")}
                                value={formData.localIp}
                                onChange={(e) => onChange("localIp", e.target.value)}
                                color={errors.localIp ? "red" : undefined}
                              />
                            </FormItem>
                          </Box>
                          <Box className="flex-1">
                            <FormItem label={t("proxy.localPort")} required error={errors.localPort}>
                              <TextField.Root
                                size="2"
                                placeholder={t("proxy.localPortPlaceholder")}
                                type="number"
                                value={formData.localPort}
                                onChange={(e) => onChange("localPort", e.target.value)}
                                color={errors.localPort ? "red" : undefined}
                              />
                            </FormItem>
                          </Box>
                        </Flex>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {isHttpType ? (
                    <>
                      <FormItem label={t("proxy.customDomainsLabel")} error={errors.customDomains}>
                        <Flex direction="column" gap="2">
                          {formData.customDomains.map((domain, index) => (
                            <Flex key={index} gap="2" align="center">
                              <TextField.Root
                                size="2"
                                style={{ flex: 1 }}
                                placeholder={`example.com`}
                                value={domain}
                                onChange={(e) => {
                                  const next = [...formData.customDomains];
                                  next[index] = e.target.value;
                                  onChange("customDomains", next);
                                }}
                              />
                              <Button
                                type="button"
                                size="2"
                                variant="soft"
                                color="red"
                                onClick={() => {
                                  const next = formData.customDomains.filter((_, i) => i !== index);
                                  onChange("customDomains", next);
                                }}
                              >
                                <Icon icon="lucide:x" />
                              </Button>
                            </Flex>
                          ))}
                          <Button
                            type="button"
                            size="2"
                            variant="soft"
                            onClick={() => onChange("customDomains", [...formData.customDomains, ""])}
                          >
                            <Icon icon="lucide:plus" />
                            {t("proxy.addCustomDomain")}
                          </Button>
                        </Flex>
                      </FormItem>
                      <FormItem label={t("proxy.subdomain")} error={errors.subdomain}>
                        <TextField.Root
                          size="2"
                          placeholder={t("proxy.subdomainPlaceholder")}
                          value={formData.subdomain}
                          onChange={(e) => onChange("subdomain", e.target.value)}
                        />
                        <Text size="1" color="gray" mt="1">
                          {t("proxy.subdomainDesc")}
                        </Text>
                      </FormItem>
                    </>
                  ) : isSecretType ? (
                    <>
                      <Callout.Root size="1" color="blue">
                        <Callout.Icon>
                          <Icon icon="lucide:info" width="14" height="14" />
                        </Callout.Icon>
                        <Callout.Text>{t("proxy.secretTypeHint")}</Callout.Text>
                      </Callout.Root>
                      <FormItem label={t("proxy.secretKey")} required error={errors.secretKey}>
                        <Flex gap="2">
                          <TextField.Root
                            size="2"
                            style={{ flex: 1 }}
                            className="font-mono"
                            value={formData.secretKey}
                            onChange={(e) => onChange("secretKey", e.target.value)}
                            color={errors.secretKey ? "red" : undefined}
                            autoComplete="off"
                          />
                          <Button type="button" size="2" variant="soft" onClick={onRegenerateSecretKey}>
                            <Icon icon="lucide:refresh-cw" width="14" height="14" />
                            {t("proxy.generateSecretKey")}
                          </Button>
                        </Flex>
                        <Text size="1" color="gray" mt="1">
                          {t("proxy.secretKeyDesc")}
                        </Text>
                      </FormItem>
                      <FormItem label={t("proxy.allowUsers")}>
                        <TextField.Root
                          size="2"
                          placeholder={t("proxy.allowUsersPlaceholder")}
                          value={formData.allowUsers}
                          onChange={(e) => onChange("allowUsers", e.target.value)}
                        />
                        <Text size="1" color="gray" mt="1">
                          {t("proxy.allowUsersDesc")}
                        </Text>
                      </FormItem>
                      <FormItem label={t("proxy.visitorServerName")}>
                        {runtimeName ? (
                          <CopyableText text={runtimeName} />
                        ) : (
                          <Text size="2" color="gray">
                            {t("proxy.visitorServerNameAfterSave")}
                          </Text>
                        )}
                        <Text size="1" color="gray" mt="1" as="p">
                          {t("proxy.visitorServerNameDesc")}
                        </Text>
                      </FormItem>
                    </>
                  ) : (
                    <FormItem label={t("proxy.remotePortLabel")} required error={errors.remotePort}>
                      <TextField.Root
                        size="2"
                        placeholder={t("proxy.remotePortPlaceholder")}
                        type="number"
                        value={formData.remotePort}
                        onChange={(e) => onChange("remotePort", e.target.value)}
                        color={errors.remotePort ? "red" : undefined}
                      />
                      <Text size="1" color="gray" mt="1">
                        {t("proxy.remotePortDesc")}
                      </Text>
                    </FormItem>
                  )}
                </Flex>
              </section>

              <Separator size="4" />

              {/* 传输选项 */}
              <section>
                <SectionHeading id="section-transport" title={t("proxy.sectionTransport")} icon="lucide:shield" />
                <Flex direction="column" gap="3">
                  <Flex justify="between" align="center">
                    <Box>
                      <Text size="2" weight="medium">{t("proxy.transportEncryption")}</Text>
                      <Text as="p" size="1" color="gray">{t("proxy.transportEncryptionDesc")}</Text>
                    </Box>
                    <Switch
                      size="2"
                      checked={formData.encryption}
                      onCheckedChange={(v) => onChange("encryption", v)}
                    />
                  </Flex>
                  <Separator size="4" />
                  <Flex justify="between" align="center">
                    <Box>
                      <Text size="2" weight="medium">{t("proxy.dataCompression")}</Text>
                      <Text as="p" size="1" color="gray">{t("proxy.dataCompressionDesc")}</Text>
                    </Box>
                    <Switch
                      size="2"
                      checked={formData.compression}
                      onCheckedChange={(v) => onChange("compression", v)}
                    />
                  </Flex>
                  <Separator size="4" />
                  <FormItem label={t("proxy.bandwidthLimit")} error={errors.bandwidthLimit}>
                    <Flex gap="2" wrap="wrap">
                      <TextField.Root
                        size="2"
                        type="number"
                        min="1"
                        style={{ flex: 1, minWidth: 120 }}
                        placeholder={t("proxy.bandwidthLimitPlaceholder")}
                        value={formData.bandwidthLimit}
                        onChange={(e) => onChange("bandwidthLimit", e.target.value)}
                        color={errors.bandwidthLimit ? "red" : undefined}
                      />
                      <Select.Root value={formData.bandwidthUnit} onValueChange={(v) => onChange("bandwidthUnit", v)}>
                        <Select.Trigger aria-label={t("proxy.bandwidthUnit")} />
                        <Select.Content>
                          <Select.Item value="KB">KB/s</Select.Item>
                          <Select.Item value="MB">MB/s</Select.Item>
                        </Select.Content>
                      </Select.Root>
                      <Select.Root value={formData.bandwidthMode} onValueChange={(v) => onChange("bandwidthMode", v)}>
                        <Select.Trigger aria-label={t("proxy.bandwidthMode")} />
                        <Select.Content>
                          <Select.Item value="client">{t("proxy.bandwidthModeClient")}</Select.Item>
                          <Select.Item value="server">{t("proxy.bandwidthModeServer")}</Select.Item>
                        </Select.Content>
                      </Select.Root>
                    </Flex>
                    <Text size="1" color="gray" mt="1" as="p">
                      {t("proxy.bandwidthLimitDesc")}
                    </Text>
                  </FormItem>
                </Flex>
              </section>

              {!usesPlugin && (
                <>
                  <Separator size="4" />

                  {/* 健康检查 */}
                  <section>
                    <SectionHeading id="section-health" title={t("proxy.sectionHealthCheck")} icon="lucide:heart-pulse" />
                    <Flex direction="column" gap="4">
                      <FormItem label={t("proxy.healthCheckType")}>
                        <Select.Root
                          value={formData.healthCheckType || "none"}
                          onValueChange={(v) => onChange("healthCheckType", v === "none" ? "" : v)}
                        >
                          <Select.Trigger style={{ width: "100%" }} />
                          <Select.Content>
                            <Select.Item value="none">{t("proxy.healthCheckNone")}</Select.Item>
                            <Select.Item value="tcp">TCP</Select.Item>
                            <Select.Item value="http">HTTP</Select.Item>
                          </Select.Content>
                        </Select.Root>
                        <Text size="1" color="gray" mt="1" as="p">
                          {t("proxy.healthCheckDesc")}
                        </Text>
                      </FormItem>
                      {formData.healthCheckType && (
                        <Flex direction="column" gap="4" className="border-l-2 border-[var(--accent-6)] pl-4">
                          {formData.healthCheckType === "http" && (
                            <FormItem label={t("proxy.healthCheckPath")} required error={errors.healthCheckPath}>
                              <TextField.Root
                                size="2"
                                placeholder="/health"
                                value={formData.healthCheckPath}
                                onChange={(e) => onChange("healthCheckPath", e.target.value)}
                                color={errors.healthCheckPath ? "red" : undefined}
                              />
                            </FormItem>
                          )}
                          <Flex gap="3" wrap="wrap">
                            {(
                              [
                                ["healthCheckInterval", "proxy.healthCheckInterval"],
                                ["healthCheckTimeout", "proxy.healthCheckTimeout"],
                                ["healthCheckMaxFailed", "proxy.healthCheckMaxFailed"],
                              ] as const
                            ).map(([field, label]) => (
                              <Box key={field} className="min-w-[140px] flex-1">
                                <FormItem label={t(label)} required error={errors[field]}>
                                  <TextField.Root
                                    size="2"
                                    type="number"
                                    min="1"
                                    value={formData[field]}
                                    onChange={(e) => onChange(field, e.target.value)}
                                    color={errors[field] ? "red" : undefined}
                                  />
                                </FormItem>
                              </Box>
                            ))}
                          </Flex>
                        </Flex>
                      )}
                    </Flex>
                  </section>
                </>
              )}

              <Separator size="4" />

              <PluginSection type={formData.type} plugin={formData.plugin} error={errors.plugin} onChange={onPluginChange} />

              <HttpOptionsSection type={formData.type} options={formData.options} error={errors.options} onChange={onOptionsChange} />

              <LoadBalancerSection type={formData.type} options={formData.options} onChange={onOptionsChange} />

              <Separator size="4" />

              <ExpirySection
                choice={formData.expiryChoice}
                custom={formData.expiryCustom}
                expiresAt={formData.expiresAt}
                error={errors.expiryCustom}
                onChange={onChange}
              />

              <Separator size="4" />

              {/* 描述 */}
              <section>
                <SectionHeading id="section-description" title={t("proxy.descriptionLabel")} icon="lucide:file-text" />
                <TextArea
                  size="2"
                  placeholder={t("proxy.descriptionPlaceholder")}
                  maxLength={1000}
                  value={formData.description}
                  onChange={(e) => onChange("description", e.target.value)}
                  className="min-h-[100px]"
                />
              </section>

              {/* Actions */}
              <Flex justify="end" gap="3" pb="6">
                <Button variant="soft" color="gray" size="2" onClick={onCancel}>
                  <Icon icon="lucide:arrow-left" width="16" height="16" />
                  {t("common.cancel")}
                </Button>
                <Button
                  size="2"
                  disabled={submitting}
                  onClick={onSubmit}
                  className="[background:linear-gradient(135deg,var(--accent-9)_0%,var(--accent-10)_100%)] text-white"
                >
                  {submitting ? (
                    <Spinner size="1" />
                  ) : isEditing ? (
                    <Icon icon="lucide:pencil" width="16" height="16" />
                  ) : (
                    <Icon icon="lucide:plus" width="16" height="16" />
                  )}
                  {submitting
                    ? isEditing ? t("proxy.saving") : t("proxy.adding")
                    : isEditing ? t("proxy.saveChanges") : t("proxy.addProxy")}
                </Button>
              </Flex>
            </Flex>
          </div>

        </div>
      </motion.div>
    </div>
  );
}
