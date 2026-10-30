import { useVisitors } from "./useVisitors";
import { VisitorsView } from "./VisitorsPage.view";

export function VisitorsPage() {
  const state = useVisitors();

  return <VisitorsView {...state} />;
}
