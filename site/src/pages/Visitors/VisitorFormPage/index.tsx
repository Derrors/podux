import { useVisitorForm } from "./useVisitorForm";
import { VisitorFormPageView } from "./VisitorFormPage.view";
import { useDelayedMount } from "../../../hooks/useDelayedMount";

export function VisitorFormPage() {
  const form = useVisitorForm();
  const mounted = useDelayedMount();

  return (
    <VisitorFormPageView
      isEditing={form.isEditing}
      formData={form.formData}
      servers={form.servers}
      secretProxies={form.secretProxies}
      loadingServers={form.loadingServers}
      loading={form.loading}
      submitting={form.submitting}
      errors={form.errors}
      mounted={mounted}
      onChange={form.handleChange}
      onFillFromProxy={form.fillFromProxy}
      onSubmit={form.handleSubmit}
      onCancel={() => form.navigate("/visitors")}
    />
  );
}
