import { useServerDetail } from "./useServerDetail";
import { ServerDetailView } from "./ServerDetailPage.view";

export function ServerDetailPage() {
  const state = useServerDetail();

  return <ServerDetailView {...state} />;
}

export default ServerDetailPage;
