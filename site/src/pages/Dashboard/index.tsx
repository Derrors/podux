import { DashboardView } from "./DashboardPage.view";
import { useDashboard } from "./useDashboard";

export function DashboardPage() {
  const { stats, topology } = useDashboard();

  return <DashboardView stats={stats} topology={topology} />;
}
