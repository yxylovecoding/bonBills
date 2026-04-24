import { create } from 'zustand';

export type SyncState = 'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'offline';

interface SyncStatusStore {
  state: SyncState;
  message: string;
  setStatus: (state: SyncState, message?: string) => void;
}

export const useSyncStatus = create<SyncStatusStore>((set) => ({
  state: 'idle',
  message: '',
  setStatus: (state, message = '') => set({ state, message }),
}));
