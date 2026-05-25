import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  PossessionCategoryBucket,
  PossessionCategoryConfig,
  PossessionItem,
  PossessionKind,
  PossessionStatus,
  PossessionTxn,
} from '../models/types';
import type { ManualTagCategory } from '../utils/tagCategory';
import { DEFAULT_CATEGORY_CONFIG } from '../data/possessionCategories';

interface PossessionStore {
  items: PossessionItem[];
  ignoredBillItemIds: string[];
  tagCategory: Record<string, ManualTagCategory>;
  categoryConfig: PossessionCategoryConfig;
  addItem: (draft: Omit<PossessionItem, 'id' | 'txns' | 'createdAt' | 'status'>) => string;
  updateItem: (id: string, patch: Partial<PossessionItem>) => void;
  removeItem: (id: string) => void;
  addTxn: (itemId: string, txn: Omit<PossessionTxn, 'id'>) => void;
  updateTxn: (itemId: string, txnId: string, patch: Partial<PossessionTxn>) => void;
  removeTxn: (itemId: string, txnId: string) => void;
  setTxnDone: (itemId: string, txnId: string, done: boolean, doneAt?: string) => void;
  setStatus: (id: string, status: PossessionStatus, retiredAt?: string) => void;
  setTagCategory: (tag: string, category: ManualTagCategory | null) => void;
  addCategory: (kind: PossessionKind, name: string) => void;
  removeCategory: (kind: PossessionKind, name: string) => void;
  setTagToCategory: (kind: PossessionKind, tag: string, category: string | null) => void;
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

function cloneDefaultCategoryConfig(): PossessionCategoryConfig {
  return {
    consumable: {
      categories: [...DEFAULT_CATEGORY_CONFIG.consumable.categories],
      tagToCategory: { ...DEFAULT_CATEGORY_CONFIG.consumable.tagToCategory },
    },
    durable: {
      categories: [...DEFAULT_CATEGORY_CONFIG.durable.categories],
      tagToCategory: { ...DEFAULT_CATEGORY_CONFIG.durable.tagToCategory },
    },
  };
}

function normalizeBucket(raw: unknown, fallback: PossessionCategoryBucket): PossessionCategoryBucket {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const categories = Array.isArray(r.categories)
    ? (r.categories as unknown[]).map((c) => String(c).trim()).filter(Boolean)
    : [...fallback.categories];
  const map: Record<string, string> = {};
  if (r.tagToCategory && typeof r.tagToCategory === 'object') {
    for (const [k, v] of Object.entries(r.tagToCategory as Record<string, unknown>)) {
      const tag = String(k).trim();
      const cat = String(v ?? '').trim();
      if (tag && cat) map[tag] = cat;
    }
  }
  return { categories: categories.length > 0 ? categories : [...fallback.categories], tagToCategory: map };
}

function normalizeCategoryConfig(raw: unknown): PossessionCategoryConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    consumable: normalizeBucket(r.consumable, DEFAULT_CATEGORY_CONFIG.consumable),
    durable: normalizeBucket(r.durable, DEFAULT_CATEGORY_CONFIG.durable),
  };
}

export const usePossessionStore = create<PossessionStore>()(
  persist(
    (set) => ({
      items: [],
      ignoredBillItemIds: [],
      tagCategory: {},
      categoryConfig: cloneDefaultCategoryConfig(),
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
      setTxnDone: (itemId, txnId, done, doneAt) =>
        set((s) => ({
          items: s.items.map((item) => (
            item.id === itemId
              ? {
                ...item,
                txns: sortTxns(item.txns.map((txn) => (
                  txn.id === txnId
                    ? { ...txn, done, doneAt: done ? (doneAt ?? txn.doneAt ?? todayKey()) : undefined }
                    : txn
                ))),
              }
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
      setTagCategory: (tag, category) =>
        set((s) => {
          const trimmed = tag.trim();
          if (!trimmed) return {};
          const next = { ...s.tagCategory };
          if (category === null) delete next[trimmed];
          else next[trimmed] = category;
          return { tagCategory: next };
        }),
      addCategory: (kind, name) =>
        set((s) => {
          const trimmed = name.trim();
          if (!trimmed) return {};
          const bucket = s.categoryConfig[kind];
          if (bucket.categories.includes(trimmed)) return {};
          return {
            categoryConfig: {
              ...s.categoryConfig,
              [kind]: { ...bucket, categories: [...bucket.categories, trimmed] },
            },
          };
        }),
      removeCategory: (kind, name) =>
        set((s) => {
          const trimmed = name.trim();
          if (!trimmed) return {};
          const bucket = s.categoryConfig[kind];
          if (!bucket.categories.includes(trimmed)) return {};
          if (bucket.categories.length <= 1) return {};
          const nextMap: Record<string, string> = {};
          for (const [tag, cat] of Object.entries(bucket.tagToCategory)) {
            if (cat !== trimmed) nextMap[tag] = cat;
          }
          return {
            categoryConfig: {
              ...s.categoryConfig,
              [kind]: {
                categories: bucket.categories.filter((c) => c !== trimmed),
                tagToCategory: nextMap,
              },
            },
          };
        }),
      setTagToCategory: (kind, tag, category) =>
        set((s) => {
          const trimmedTag = tag.trim();
          if (!trimmedTag) return {};
          const bucket = s.categoryConfig[kind];
          const nextMap = { ...bucket.tagToCategory };
          if (category === null) {
            delete nextMap[trimmedTag];
          } else {
            const trimmedCat = category.trim();
            if (!trimmedCat) return {};
            if (!bucket.categories.includes(trimmedCat)) return {};
            nextMap[trimmedTag] = trimmedCat;
          }
          return {
            categoryConfig: {
              ...s.categoryConfig,
              [kind]: { ...bucket, tagToCategory: nextMap },
            },
          };
        }),
      applyAutoImportedItems: (items) => set({ items: items.map((item) => ({ ...item, txns: sortTxns(item.txns) })) }),
    }),
    {
      name: 'possessions',
      version: 3,
      partialize: (state) => ({
        items: state.items,
        ignoredBillItemIds: state.ignoredBillItemIds,
        tagCategory: state.tagCategory,
        categoryConfig: state.categoryConfig,
      }),
      migrate: (persistedState, fromVersion) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState;
        const p = persistedState as Record<string, unknown>;
        // v1 → v2: excludedNameTags[] 全部转成 tagCategory[tag] = 'ignore'
        if (fromVersion < 2 && Array.isArray(p.excludedNameTags)) {
          const migrated: Record<string, ManualTagCategory> = { ...(p.tagCategory as Record<string, ManualTagCategory> | undefined ?? {}) };
          for (const tag of p.excludedNameTags as string[]) {
            const trimmed = String(tag).trim();
            if (trimmed && !migrated[trimmed]) migrated[trimmed] = 'ignore';
          }
          p.tagCategory = migrated;
          delete p.excludedNameTags;
        }
        // v2 → v3: 补 categoryConfig
        if (fromVersion < 3) {
          p.categoryConfig = normalizeCategoryConfig(p.categoryConfig);
        }
        return p;
      },
      merge: (persisted, current) => {
        const p = persisted as Partial<PossessionStore> & { excludedNameTags?: unknown } | undefined;
        const tagCategory: Record<string, ManualTagCategory> = { ...(p?.tagCategory ?? {}) };
        // 兜底：万一 migrate 没走到（旧持久化没有 version 字段），运行时也补一次
        if (Array.isArray(p?.excludedNameTags)) {
          for (const tag of p?.excludedNameTags as string[]) {
            const trimmed = String(tag).trim();
            if (trimmed && !tagCategory[trimmed]) tagCategory[trimmed] = 'ignore';
          }
        }
        return {
          ...current,
          items: Array.isArray(p?.items) ? p.items : current.items,
          ignoredBillItemIds: Array.isArray(p?.ignoredBillItemIds) ? p.ignoredBillItemIds : [],
          tagCategory,
          categoryConfig: normalizeCategoryConfig(p?.categoryConfig),
        };
      },
    },
  ),
);
