import { create } from 'zustand';

export type SyncState = 'idle' | 'loading' | 'saving' | 'saved' | 'error' | 'offline';

interface SyncStatusStore {
  state: SyncState;
  message: string;
  ready: boolean;
  setReady: (ready: boolean) => void;
  revision: number;
  markRefreshed: () => void;
  setStatus: (state: SyncState, message?: string) => void;
}

export const useSyncStatus = create<SyncStatusStore>((set) => ({
  state: 'idle',
  message: '',
  ready: false,
  setReady: (ready) => set({ ready }),
  revision: 0,
  markRefreshed: () => set((state) => ({ revision: state.revision + 1 })),
  setStatus: (state, message = '') => set({ state, message }),
}));
