import { AlertDialog, Button, Flex } from "@radix-ui/themes";
import { Icon } from "@iconify/react/offline";
import { useTranslation } from "react-i18next";

interface ConfirmDeleteDialogProps {
  open: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  onClose: () => void;
}

/** Red-confirm AlertDialog used for destructive list actions. */
export function ConfirmDeleteDialog({
  open,
  title,
  description,
  onConfirm,
  onClose,
}: ConfirmDeleteDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialog.Content maxWidth="450px">
        <AlertDialog.Title>{title}</AlertDialog.Title>
        <AlertDialog.Description size="2">{description}</AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              <Icon icon="lucide:x" width="16" height="16" />
              {t("common.cancel")}
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button variant="solid" color="red" onClick={onConfirm}>
              <Icon icon="lucide:trash-2" width="16" height="16" />
              {t("common.delete")}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
