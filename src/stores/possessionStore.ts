import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PossessionItem, PossessionStatus, PossessionTxn } from '../models/types';

interface PossessionStore {
  items: PossessionItem[];
  ignoredBillItemIds: string[];
  addItem: (draft: Omit<PossessionItem, 'id' | 'txns' | 'createdAt' | 'status'>) => string;
  updateItem: (id: string, patch: Partial<PossessionItem>) => void;
  removeItem: (id: string) => void;
  addTxn: (itemId: string, txn: Omit<PossessionTxn, 'id'>) => void;
  updateTxn: (itemId: string, txnId: string, patch: Partial<PossessionTxn>) => void;
  removeTxn: (itemId: string, txnId: string) => void;
  setStatus: (id: string, status: PossessionStatus, retiredAt?: string) => void;
  applyAutoImportedItems: (items: PossessionItem[]) => void;
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
      ignoredBillItemIds: [],
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
      removeItem: (id) =>
        set((s) => {
          const removed = s.items.find((item) => item.id === id);
          const ignored = new Set(s.ignoredBillItemIds);
          for (const txn of removed?.txns ?? []) {
            if (txn.billItemId) ignored.add(txn.billItemId);
          }
          return {
            items: s.items.filter((item) => item.id !== id),
            ignoredBillItemIds: [...ignored],
          };
        }),
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
        set((s) => {
          const item = s.items.find((candidate) => candidate.id === itemId);
          const removed = item?.txns.find((txn) => txn.id === txnId);
          const ignored = new Set(s.ignoredBillItemIds);
          if (removed?.billItemId) ignored.add(removed.billItemId);
          return {
            items: s.items.map((candidate) => (
              candidate.id === itemId
                ? { ...candidate, txns: candidate.txns.filter((txn) => txn.id !== txnId) }
                : candidate
            )),
            ignoredBillItemIds: [...ignored],
          };
        }),
      setStatus: (id, status, retiredAt) =>
        set((s) => ({
          items: s.items.map((item) => (
            item.id === id
              ? { ...item, status, retiredAt: status === 'retired' ? (retiredAt ?? item.retiredAt ?? todayKey()) : undefined }
              : item
          )),
        })),
      applyAutoImportedItems: (items) => set({ items: items.map((item) => ({ ...item, txns: sortTxns(item.txns) })) }),
    }),
    {
      name: 'possessions',
      version: 1,
      partialize: (state) => ({ items: state.items, ignoredBillItemIds: state.ignoredBillItemIds }),
      merge: (persisted, current) => {
        const p = persisted as Partial<PossessionStore> | undefined;
        return {
          ...current,
          items: Array.isArray(p?.items) ? p.items : current.items,
          ignoredBillItemIds: Array.isArray(p?.ignoredBillItemIds) ? p.ignoredBillItemIds : [],
        };
      },
    },
  ),
);
