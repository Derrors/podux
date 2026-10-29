import { create } from "zustand";
import { persist } from "zustand/middleware";
import { apiGet, getErrorMessage } from "../lib/api";

interface SystemSettings {
  initialized: boolean;
  defaultLanguage: "en" | "zh";
}

interface SystemSettingsResponse {
  initialized: boolean;
  general?: { defaultLanguage?: "en" | "zh" };
}

interface SystemStore {
  settings: SystemSettings | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  /**
   * Resolves with the backend's `initialized` flag. Network/5xx failures reject
   * instead of resolving false, so callers never mistake an outage for "not initialized".
   */
  checkInitialized: () => Promise<boolean>;
  getSettings: () => Promise<void>;
  setSettings: (settings: SystemSettings) => void;
  clearSettings: () => void;
}

export const useSystemStore = create<SystemStore>()(
  persist(
    (set) => ({
      settings: null,
      isLoading: false,
      error: null,

      checkInitialized: async () => {
        set({ isLoading: true, error: null });
        try {
          const data = await apiGet<{ initialized: boolean }>("/api/system/initialized");
          return data.initialized === true;
        } catch (error) {
          set({ error: getErrorMessage(error) ?? null });
          throw error;
        } finally {
          set({ isLoading: false });
        }
      },

      getSettings: async () => {
        set({ isLoading: true, error: null });
        try {
          const data = await apiGet<SystemSettingsResponse>("/api/system/settings");
          set({
            settings: {
              initialized: data.initialized,
              defaultLanguage: data.general?.defaultLanguage || "en",
            },
          });
        } catch (error) {
          set({ error: getErrorMessage(error) ?? null });
        } finally {
          set({ isLoading: false });
        }
      },

      setSettings: (settings) => {
        set({ settings });
      },

      clearSettings: () => {
        set({ settings: null, error: null });
      },
    }),
    {
      name: "system-storage",
      partialize: (state) => ({ settings: state.settings }),
    }
  )
);
