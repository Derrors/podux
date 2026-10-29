import { create } from "zustand";
import { apiGet } from "../lib/api";

interface SystemStore {
  /**
   * Resolves with the backend's `initialized` flag. Network/5xx failures reject
   * instead of resolving false, so callers never mistake an outage for "not initialized".
   */
  checkInitialized: () => Promise<boolean>;
}

export const useSystemStore = create<SystemStore>()(() => ({
  checkInitialized: async () => {
    const data = await apiGet<{ initialized: boolean }>("/api/system/initialized");
    return data.initialized === true;
  },
}));
