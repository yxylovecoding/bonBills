import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppConfig } from '../models/types';
import defaultConfig from '../data/appConfig.json';

const DEFAULT_CONFIG: AppConfig = defaultConfig as AppConfig;

interface ConfigStore {
  config: AppConfig;
  setConfig: (c: Partial<AppConfig>) => void;
  resetConfig: () => void;
}

export const useConfigStore = create<ConfigStore>()(
  persist(
    (set) => ({
      config: DEFAULT_CONFIG,
      setConfig: (c) => set((s) => ({ config: { ...s.config, ...c } })),
      resetConfig: () => set({ config: DEFAULT_CONFIG }),
    }),
    { name: 'app-config' },
  ),
);
