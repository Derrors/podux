import { toast } from "sonner";
import { getErrorMessage, isAbortError } from "./api";

/**
 * Shows a translated error toast; the backend/SDK message (if any) becomes the description.
 * Pass a stable `id` for errors that can repeat (e.g. polling) so toasts replace each other.
 */
export function notifyError(title: string, err?: unknown, id?: string) {
  if (err !== undefined && isAbortError(err)) return;
  const detail = err === undefined ? undefined : getErrorMessage(err);
  toast.error(title, {
    id,
    description: detail && detail !== title ? detail : undefined,
  });
}
