import { DashboardView } from "./DashboardPage.view";
import { useDashboard } from "./useDashboard";

export function DashboardPage() {
  const dashboard = useDashboard();

  return <DashboardView {...dashboard} />;
}
