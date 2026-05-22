import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PossessionItem, PossessionStatus, PossessionTxn } from '../models/types';

interface PossessionStore {
  items: PossessionItem[];
  addItem: (draft: Omit<PossessionItem, 'id' | 'txns' | 'createdAt' | 'status'>) => string;
  updateItem: (id: string, patch: Partial<PossessionItem>) => void;
  removeItem: (id: string) => void;
  addTxn: (itemId: string, txn: Omit<PossessionTxn, 'id'>) => void;
  updateTxn: (itemId: string, txnId: string, patch: Partial<PossessionTxn>) => void;
  removeTxn: (itemId: string, txnId: string) => void;
  setStatus: (id: string, status: PossessionStatus, retiredAt?: string) => void;
}

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `pos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function sortTxns(txns: PossessionTxn[]) {
  return [...txns].sort((a, b) => a.date.localeCompare(b.date));
}

export const usePossessionStore = create<PossessionStore>()(
  persist(
    (set) => ({
      items: [],
      addItem: (draft) => {
        const id = makeId();
        const item: PossessionItem = {
          ...draft,
          id,
          status: 'active',
          txns: [],
          createdAt: todayKey(),
        };
        set((s) => ({ items: [...s.items, item] }));
        return id;
      },
      updateItem: (id, patch) =>
        set((s) => ({
          items: s.items.map((item) => (
            item.id === id
              ? { ...item, ...patch, id: item.id, txns: patch.txns ? sortTxns(patch.txns) : item.txns }
              : item
          )),
        })),
      removeItem: (id) => set((s) => ({ items: s.items.filter((item) => item.id !== id) })),
      addTxn: (itemId, txn) =>
        set((s) => ({
          items: s.items.map((item) => (
            item.id === itemId
              ? { ...item, txns: sortTxns([...item.txns, { ...txn, id: makeId() }]) }
              : item
          )),
        })),
      updateTxn: (itemId, txnId, patch) =>
        set((s) => ({
          items: s.items.map((item) => (
            item.id === itemId
              ? {
                ...item,
                txns: sortTxns(item.txns.map((txn) => (
                  txn.id === txnId ? { ...txn, ...patch, id: txn.id } : txn
                ))),
              }
              : item
          )),
        })),
      removeTxn: (itemId, txnId) =>
        set((s) => ({
          items: s.items.map((item) => (
            item.id === itemId
              ? { ...item, txns: item.txns.filter((txn) => txn.id !== txnId) }
              : item
          )),
        })),
      setStatus: (id, status, retiredAt) =>
        set((s) => ({
          items: s.items.map((item) => (
            item.id === id
              ? { ...item, status, retiredAt: status === 'retired' ? (retiredAt ?? item.retiredAt ?? todayKey()) : undefined }
              : item
          )),
        })),
    }),
    {
      name: 'possessions',
      version: 1,
      partialize: (state) => ({ items: state.items }),
    },
  ),
);
