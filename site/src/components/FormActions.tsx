import { Icon } from "@iconify/react/offline";
import { Button, Flex, Spinner } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";

export function FormActions({
  onCancel,
  onSubmit,
  submitting,
  label,
  busyLabel,
  editing = false,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  label: string;
  busyLabel: string;
  editing?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Flex justify="end" gap="3" className="form-actions">
      <Button type="button" variant="soft" color="gray" onClick={onCancel} disabled={submitting}>
        {t("common.cancel")}
      </Button>
      <Button type="button" disabled={submitting} onClick={onSubmit}>
        {submitting ? (
          <Spinner size="1" />
        ) : (
          <Icon icon={editing ? "lucide:check" : "lucide:plus"} width="16" height="16" />
        )}
        {submitting ? busyLabel : label}
      </Button>
    </Flex>
  );
}
