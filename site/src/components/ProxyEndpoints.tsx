import { Flex, Text } from "@radix-ui/themes";
import type { Proxy } from "../types/proxy";
import { CopyableText } from "./CopyableText";

interface ProxyEndpointsProps {
  proxy: Proxy;
  /** Address of the proxy's server, used to build `<subdomain>.<serverAddr>`. */
  serverAddr?: string;
}

/** Remote port (tcp/udp) or the public domains (http/https) of a proxy, each click-to-copy. */
export function ProxyEndpoints({ proxy, serverAddr }: ProxyEndpointsProps) {
  if (proxy.proxyType === "http" || proxy.proxyType === "https") {
    const domains: string[] = [];
    if (proxy.subdomain && serverAddr) domains.push(`${proxy.subdomain}.${serverAddr}`);
    if (proxy.customDomains?.length) domains.push(...proxy.customDomains);
    if (domains.length === 0) {
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
