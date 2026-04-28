import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ConsumableProduct,
  PurchaseExtra,
  PriceCandidate,
} from '../models/types';
import { genId } from '../utils/consumables';

interface ConsumableStore {
  products: ConsumableProduct[];
  purchaseExtras: Record<string, PurchaseExtra>;   // key = expenseItemId
  candidates: PriceCandidate[];

  createProduct: (input: { name: string; matchKeys?: string[]; unit?: string }) => string;
  updateProduct: (id: string, patch: Partial<Omit<ConsumableProduct, 'id' | 'createdAt'>>) => void;
  deleteProduct: (id: string) => void;
  attachMatchKey: (id: string, key: string) => void;
  detachMatchKey: (id: string, key: string) => void;

  setPurchaseExtra: (itemId: string, patch: Partial<PurchaseExtra>) => void;
  clearPurchaseExtra: (itemId: string) => void;

  addCandidate: (input: Omit<PriceCandidate, 'id' | 'addedAt'>) => string;
  updateCandidate: (id: string, patch: Partial<Omit<PriceCandidate, 'id' | 'productId' | 'addedAt'>>) => void;
  deleteCandidate: (id: string) => void;
  setPinnedCandidate: (productId: string, candidateId: string | null) => void;
}

export const useConsumableStore = create<ConsumableStore>()(
  persist(
    (set) => ({
      products: [],
      purchaseExtras: {},
      candidates: [],

      createProduct: (input) => {
        const id = genId('prod');
        const now = Date.now();
        const product: ConsumableProduct = {
          id,
          name: input.name.trim() || '未命名',
          unit: input.unit,
          matchKeys: Array.from(new Set(input.matchKeys || [])),
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ products: [...s.products, product] }));
        return id;
      },

      updateProduct: (id, patch) =>
        set((s) => ({
          products: s.products.map((p) =>
            p.id === id ? { ...p, ...patch, matchKeys: patch.matchKeys ? Array.from(new Set(patch.matchKeys)) : p.matchKeys, updatedAt: Date.now() } : p,
          ),
        })),

      deleteProduct: (id) =>
        set((s) => ({
          products: s.products.filter((p) => p.id !== id),
          candidates: s.candidates.filter((c) => c.productId !== id),
          purchaseExtras: Object.fromEntries(
            Object.entries(s.purchaseExtras).map(([k, v]) =>
              v.productId === id ? [k, { ...v, productId: undefined }] : [k, v],
            ),
          ),
        })),

      attachMatchKey: (id, key) =>
        set((s) => ({
          products: s.products.map((p) => {
            if (p.id !== id) {
              // 同时把这个 key 从其他 product 中移除，保证唯一归属
              if (p.matchKeys.includes(key)) {
                return { ...p, matchKeys: p.matchKeys.filter((k) => k !== key), updatedAt: Date.now() };
              }
              return p;
            }
            if (p.matchKeys.includes(key)) return p;
            return { ...p, matchKeys: [...p.matchKeys, key], updatedAt: Date.now() };
          }),
        })),

      detachMatchKey: (id, key) =>
        set((s) => ({
          products: s.products.map((p) =>
            p.id === id ? { ...p, matchKeys: p.matchKeys.filter((k) => k !== key), updatedAt: Date.now() } : p,
          ),
        })),

      setPurchaseExtra: (itemId, patch) =>
        set((s) => {
          const prev = s.purchaseExtras[itemId] || {};
          const next = { ...prev, ...patch };
          // 清理空字段
          const cleaned: PurchaseExtra = {};
          if (next.spec) cleaned.spec = next.spec;
          if (typeof next.qty === 'number' && next.qty > 0) cleaned.qty = next.qty;
          if (next.productId) cleaned.productId = next.productId;
          if (next.excluded) cleaned.excluded = true;
          const isEmpty = Object.keys(cleaned).length === 0;
          const map = { ...s.purchaseExtras };
          if (isEmpty) delete map[itemId];
          else map[itemId] = cleaned;
          return { purchaseExtras: map };
        }),

      clearPurchaseExtra: (itemId) =>
        set((s) => {
          if (!s.purchaseExtras[itemId]) return s;
          const map = { ...s.purchaseExtras };
          delete map[itemId];
          return { purchaseExtras: map };
        }),

      addCandidate: (input) => {
        const id = genId('cand');
        const candidate: PriceCandidate = { id, addedAt: Date.now(), ...input };
        set((s) => ({ candidates: [...s.candidates, candidate] }));
        return id;
      },

      updateCandidate: (id, patch) =>
        set((s) => ({
          candidates: s.candidates.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),

      deleteCandidate: (id) =>
        set((s) => ({ candidates: s.candidates.filter((c) => c.id !== id) })),

      setPinnedCandidate: (productId, candidateId) =>
        set((s) => ({
          candidates: s.candidates.map((c) =>
            c.productId === productId ? { ...c, pinned: c.id === candidateId } : c,
          ),
        })),
    }),
    {
      name: 'consumables',
      partialize: (state) => ({
        products: state.products,
        purchaseExtras: state.purchaseExtras,
        candidates: state.candidates,
      }),
    },
  ),
);
