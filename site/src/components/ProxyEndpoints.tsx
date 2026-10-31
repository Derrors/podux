import { Flex, Text, Tooltip } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { isSecretProxyType, proxyRuntimeName, type Proxy } from "../types/proxy";
import { CopyableText } from "./CopyableText";

interface ProxyEndpointsProps {
  proxy: Proxy;
  /** frps subdomainHost, from its dashboard; without it only the subdomain is known. */
  subdomainHost?: string;
}

/**
 * Remote port (tcp/udp), public domains (http/https) or, for stcp/sudp/xtcp, the
 * name visitors must use, each click-to-copy.
 */
export function ProxyEndpoints({ proxy, subdomainHost }: ProxyEndpointsProps) {
  const { t } = useTranslation();
  if (isSecretProxyType(proxy.proxyType)) {
    return (
      <Flex direction="column" gap="1">
        <Text size="1" color="gray">
          {t("proxy.visitorServerName")}
        </Text>
        <CopyableText text={proxyRuntimeName(proxy)} />
      </Flex>
    );
  }
  if (proxy.proxyType === "http" || proxy.proxyType === "https") {
    const domains: string[] = [];
    if (proxy.subdomain && subdomainHost) domains.push(`${proxy.subdomain}.${subdomainHost}`);
    if (proxy.customDomains?.length) domains.push(...proxy.customDomains);
    // frps serves subdomains under its subdomainHost, which only its dashboard reports.
    const bareSubdomain = proxy.subdomain && !subdomainHost ? proxy.subdomain : "";
    if (domains.length === 0 && !bareSubdomain) {
      return (
        <Text size="2" color="gray">
          -
        </Text>
      );
    }
    return (
      <Flex direction="column" gap="1">
        {domains.map((domain, i) => (
          <CopyableText key={`${i}:${domain}`} text={domain} />
        ))}
        {bareSubdomain && (
          <Tooltip content={t("proxy.subdomainHostUnknown")}>
            <Text size="2" color="gray">
              {t("proxy.subdomainOnly", { name: bareSubdomain })}
            </Text>
          </Tooltip>
        )}
      </Flex>
    );
  }

  if (!proxy.remotePort) {
    return (
      <Text size="2" color="gray">
        -
      </Text>
    );
  }
  return <CopyableText text={String(proxy.remotePort)} />;
}
