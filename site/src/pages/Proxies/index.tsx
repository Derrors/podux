import { useProxies } from "./useProxies";
import { ProxiesView } from "./ProxiesPage.view";

export function ProxiesPage() {
  const state = useProxies();

  return <ProxiesView {...state} />;
}

export default ProxiesPage;
