import { useEffect, useState } from "react";
import pb from "../lib/pocketbase";

/**
 * The signed-in user's record, re-rendering whenever the auth store changes
 * (login, logout, `pb.authStore.save` after a profile update).
 * Kept in state because the SDK's LocalAuthStore returns a new object on every read.
 */
export function useAuthRecord() {
  const [record, setRecord] = useState(() => pb.authStore.record);
  useEffect(() => pb.authStore.onChange((_token, next) => setRecord(next)), []);
  return record;
}
