import { Icon } from "@iconify/react/offline";
import { Box, Button, Checkbox, Flex, IconButton, Switch, Text, TextArea, TextField } from "@radix-ui/themes";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FormItem } from "../../../components/FormItem";
import type { AuthScope } from "../../../types/server";
import type { ServerFormData } from "./useServerForm";

type Auth = ServerFormData["auth"];
type AuthChange = <K extends keyof Auth>(field: K, value: Auth[K]) => void;

const SCOPES: AuthScope[] = ["HeartBeats", "NewWorkConns"];

/** auth.additionalScopes, for token and OIDC: authenticate more than the login. */
export function AuthScopesField({ auth, onChange }: { auth: Auth; onChange: AuthChange }) {
  const { t } = useTranslation();
  return (
    <FormItem label={t("server.additionalScopes")}>
      <Flex direction="column" gap="2">
        {SCOPES.map((scope) => (
          <Text as="label" size="2" key={scope}>
            <Flex gap="2" align="center">
              <Checkbox
                checked={auth.additionalScopes.includes(scope)}
                onCheckedChange={(v) =>
                  onChange(
                    "additionalScopes",
                    v === true ? [...auth.additionalScopes, scope] : auth.additionalScopes.filter((s) => s !== scope)
                  )
                }
              />
              {t(`server.scope${scope}`)}
            </Flex>
          </Text>
        ))}
        <Text size="1" color="gray">
          {t("server.additionalScopesDesc")}
        </Text>
      </Flex>
    </FormItem>
  );
}

/** OIDC client credentials (frp auth.oidc), stored as flat oidc* keys in fh_servers.auth. */
export function OidcFields({ auth, errors, onChange }: { auth: Auth; errors: Record<string, string>; onChange: AuthChange }) {
  const { t } = useTranslation();
  const [showSecret, setShowSecret] = useState(false);
  const [paramKey, setParamKey] = useState("");
  const [paramValue, setParamValue] = useState("");
  const params = Object.entries(auth.oidcAdditionalParams);

  const addParam = () => {
    const key = paramKey.trim();
    if (!key) return;
    onChange("oidcAdditionalParams", { ...auth.oidcAdditionalParams, [key]: paramValue });
    setParamKey("");
    setParamValue("");
  };
  const removeParam = (key: string) => {
    const next = { ...auth.oidcAdditionalParams };
    delete next[key];
    onChange("oidcAdditionalParams", next);
  };
  const loadCa = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    file?.text().then((text) => onChange("oidcTrustedCa", text));
  };

  return (
    <Flex direction="column" gap="3">
      <Text size="1" color="gray" as="p">
        {t("server.oidcDesc")}
      </Text>
      <FormItem label={t("server.clientId")} required error={errors.oidcClientId}>
        <TextField.Root
          size="2"
          placeholder={t("server.clientIdPlaceholder")}
          value={auth.oidcClientId}
          color={errors.oidcClientId ? "red" : undefined}
          onChange={(e) => onChange("oidcClientId", e.target.value)}
        />
      </FormItem>
      <FormItem label={t("server.clientSecret")}>
        <TextField.Root
          size="2"
          type={showSecret ? "text" : "password"}
          autoComplete="new-password"
          placeholder={t("server.clientSecretPlaceholder")}
          value={auth.oidcClientSecret}
          onChange={(e) => onChange("oidcClientSecret", e.target.value)}
        >
          <TextField.Slot side="right">
            <Icon
              icon={showSecret ? "lucide:eye-off" : "lucide:eye"}
              className="cursor-pointer"
              onClick={() => setShowSecret(!showSecret)}
            />
          </TextField.Slot>
        </TextField.Root>
      </FormItem>
      <FormItem label={t("server.tokenEndpoint")} required error={errors.oidcTokenEndpoint}>
        <TextField.Root
          size="2"
          placeholder={t("server.tokenEndpointPlaceholder")}
          value={auth.oidcTokenEndpoint}
          color={errors.oidcTokenEndpoint ? "red" : undefined}
          onChange={(e) => onChange("oidcTokenEndpoint", e.target.value)}
        />
      </FormItem>
      <Flex gap="3" wrap="wrap">
        <Box className="min-w-[200px] flex-1">
          <FormItem label={t("server.audience")}>
            <TextField.Root
              size="2"
              placeholder={t("server.audiencePlaceholder")}
              value={auth.oidcAudience}
              onChange={(e) => onChange("oidcAudience", e.target.value)}
            />
          </FormItem>
        </Box>
        <Box className="min-w-[200px] flex-1">
          <FormItem label={t("server.oidcScope")}>
            <TextField.Root
              size="2"
              placeholder={t("server.oidcScopePlaceholder")}
              value={auth.oidcScope}
              onChange={(e) => onChange("oidcScope", e.target.value)}
            />
          </FormItem>
        </Box>
      </Flex>

      <FormItem label={t("server.oidcParams")} error={errors.oidcAdditionalParams}>
        <Flex direction="column" gap="2">
          {params.map(([key, value]) => (
            <Flex key={key} gap="2" align="center">
              <Text size="2" className="font-mono" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                {key} = {value}
              </Text>
              <IconButton size="1" variant="ghost" color="red" aria-label={t("common.delete")} onClick={() => removeParam(key)}>
                <Icon icon="lucide:x" width="14" height="14" />
              </IconButton>
            </Flex>
          ))}
          <Flex gap="2" wrap="wrap">
            <TextField.Root
              size="2"
              className="min-w-[120px] flex-1"
              placeholder={t("server.oidcParamKey")}
              value={paramKey}
              onChange={(e) => setParamKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addParam())}
            />
            <TextField.Root
              size="2"
              className="min-w-[120px] flex-1"
              placeholder={t("server.oidcParamValue")}
              value={paramValue}
              onChange={(e) => setParamValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addParam())}
            />
            <Button size="2" variant="soft" disabled={!paramKey.trim()} onClick={addParam}>
              <Icon icon="lucide:plus" width="14" height="14" />
              {t("common.add")}
            </Button>
          </Flex>
          <Text size="1" color="gray">
            {t("server.oidcParamsDesc")}
          </Text>
        </Flex>
      </FormItem>

      <FormItem label={t("server.oidcTrustedCa")}>
        <Flex direction="column" gap="2">
          <TextArea
            size="2"
            placeholder={t("server.trustedCAPlaceholder")}
            value={auth.oidcTrustedCa}
            onChange={(e) => onChange("oidcTrustedCa", e.target.value)}
            className="min-h-[80px] font-mono text-[12px]"
          />
          <Flex justify="between" align="center" gap="2" wrap="wrap">
            <Text size="1" color="gray">
              {t("server.oidcTrustedCaDesc")}
            </Text>
            <input type="file" id="file-upload-oidc-ca" className="hidden" onChange={loadCa} />
            <Button size="1" variant="soft" onClick={() => document.getElementById("file-upload-oidc-ca")?.click()}>
              <Icon icon="lucide:upload" width="14" height="14" />
              {t("server.loadFromFile")}
            </Button>
          </Flex>
        </Flex>
      </FormItem>

      <Flex justify="between" align="center" gap="3">
        <Box>
          <Text size="2" weight="medium">
            {t("server.oidcSkipVerify")}
          </Text>
          <Text as="p" size="1" color={auth.oidcInsecureSkipVerify ? "orange" : "gray"}>
            {t("server.oidcSkipVerifyDesc")}
          </Text>
        </Box>
        <Switch checked={auth.oidcInsecureSkipVerify} onCheckedChange={(v) => onChange("oidcInsecureSkipVerify", v)} />
      </Flex>
    </Flex>
  );
}
