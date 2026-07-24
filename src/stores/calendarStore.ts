import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TagKind } from '../models/types';

// tagMap: { "2026-04-11": "school", ... }
type TagMap = Record<string, TagKind>;
// localIds: 显式归本地的账单 id
// travelIds: localIds 的子集，显式归“游”的本地账单 id
// sharedIds: 显式归共享的账单 id（undefined = 旧数据，按"日级 reviewed → 未勾即共享"兜底）
// reviewed: 该天用户是否动过（用于日历圆点 + 旧数据兜底语义）
export type ConfirmedExpenseAssignment = 'local' | 'travel' | 'shared';
export type ConfirmedExpenseSelection = {
  localIds: string[];
  travelIds?: string[];
  sharedIds?: string[];
  reviewed: boolean;
};
type LegacyConfirmedExpenseSelection = {
  ids?: unknown[];
  localIds?: unknown[];
  travelIds?: unknown[];
  sharedIds?: unknown[];
  reviewed?: unknown;
} & Record<string, unknown>;
type LegacyConfirmedExpenses = Record<string, string[] | LegacyConfirmedExpenseSelection>;
const LEGACY_SHARED_IDS_KEY = 'long' + 'Ids';

function normalizeIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

export function normalizeConfirmedSelection(value: unknown): ConfirmedExpenseSelection {
  if (Array.isArray(value)) return { localIds: normalizeIds(value), reviewed: value.length > 0 };
  if (!value || typeof value !== 'object') return { localIds: [], reviewed: false };
  const raw = value as LegacyConfirmedExpenseSelection;
  const travelIds = normalizeIds(raw.travelIds);
  const localIds = [...new Set([...normalizeIds(raw.localIds ?? raw.ids), ...travelIds])];
  const sharedIdsRaw = raw.sharedIds ?? raw[LEGACY_SHARED_IDS_KEY];
  const sharedIds = Array.isArray(sharedIdsRaw) ? normalizeIds(sharedIdsRaw) : undefined;
  const reviewed = typeof raw.reviewed === 'boolean'
    ? raw.reviewed
    : localIds.length > 0 || travelIds.length > 0 || (sharedIds?.length ?? 0) > 0;
  return {
    localIds,
    ...(travelIds.length > 0 ? { travelIds } : {}),
    ...(sharedIds !== undefined ? { sharedIds } : {}),
    reviewed,
  };
}

export function normalizeConfirmedExpenses(input: unknown): Record<string, ConfirmedExpenseSelection> {
  if (!input || typeof input !== 'object') return {};
  const result: Record<string, ConfirmedExpenseSelection> = {};
  for (const [date, value] of Object.entries(input as LegacyConfirmedExpenses)) {
    result[date] = normalizeConfirmedSelection(value);
  }
  return result;
}

interface CalendarStore {
  tagMap: TagMap;
  initializedFromRecords: boolean; // 防止重复执行一次性初始化
  // confirmedExpenses: 用户在「明细」模式下勾选的「这天确切发生的支出」
  // key: 'YYYY-MM-DD'，value: 已确认状态 + 当日已勾选的 expenseItemId 列表（id 由 importBill.ts 派生）
  confirmedExpenses: Record<string, ConfirmedExpenseSelection>;
  setTag: (date: string, tag: TagKind) => void;
  removeTag: (date: string) => void;
  toggleTag: (date: string, tag: TagKind) => void;
  getTagsForMonth: (yearMonth: string) => TagMap;
  countByTag: (yearMonth: string) => Record<TagKind, number>;
  bulkFillSchool: (fromDate: string, toDate: string) => void;
  initMonthFromCounts: (yearMonth: string, counts: { school: number; intern: number; home: number; travel: number }) => void;
  markInitialized: () => void;
  toggleConfirmedExpense: (date: string, id: string) => void;
  setConfirmedExpenseScope: (date: string, id: string, scope: ConfirmedExpenseAssignment) => void;
  markConfirmedExpenseZero: (date: string) => void;
  clearConfirmedExpenseSelection: (date: string) => void;
}

export const useCalendarStore = create<CalendarStore>()(
  persist(
    (set, get) => ({
      tagMap: {},
      initializedFromRecords: false,
      confirmedExpenses: {},

      setTag: (date, tag) =>
        set((s) => ({ tagMap: { ...s.tagMap, [date]: tag } })),

      removeTag: (date) =>
        set((s) => {
          const next = { ...s.tagMap };
          delete next[date];
          return { tagMap: next };
        }),

      toggleTag: (date, tag) => {
        const current = get().tagMap[date];
        if (current === tag) {
          get().removeTag(date);
        } else {
          get().setTag(date, tag);
        }
      },

      getTagsForMonth: (yearMonth) => {
        const map = get().tagMap;
        const result: TagMap = {};
        for (const [date, tag] of Object.entries(map)) {
          if (date.startsWith(yearMonth)) result[date] = tag;
        }
        return result;
      },

      countByTag: (yearMonth) => {
        const monthMap = get().getTagsForMonth(yearMonth);
        const counts: Record<TagKind, number> = { intern: 0, school: 0, home: 0, travel: 0 };
        for (const tag of Object.values(monthMap)) counts[tag]++;
        return counts;
      },

      bulkFillSchool: (fromDate, toDate) =>
        set((s) => {
          const next = { ...s.tagMap };
          const cur = new Date(fromDate + 'T00:00:00');
          const end = new Date(toDate + 'T00:00:00');
          while (cur <= end) {
            const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
            if (!next[key]) next[key] = 'school';
            cur.setDate(cur.getDate() + 1);
          }
          return { tagMap: next };
        }),

      // 按天数分配某月的状态标签（覆盖写入）
      // 分配顺序（从月末往前）：home → travel → intern → school
      initMonthFromCounts: (yearMonth, counts) =>
        set((s) => {
          const [y, m] = yearMonth.split('-').map(Number);
          const daysInMonth = new Date(y, m, 0).getDate();
          const days: string[] = Array.from({ length: daysInMonth }, (_, i) =>
            `${yearMonth}-${String(i + 1).padStart(2, '0')}`,
          ).reverse();

          const assignments: TagMap = {};
          let idx = 0;
          for (let i = 0; i < counts.home;   i++) assignments[days[idx++]] = 'home';
          for (let i = 0; i < counts.travel;  i++) assignments[days[idx++]] = 'travel';
          for (let i = 0; i < counts.intern;  i++) assignments[days[idx++]] = 'intern';
          while (idx < daysInMonth) assignments[days[idx++]] = 'school';

          return { tagMap: { ...s.tagMap, ...assignments } };
        }),

      markInitialized: () => set({ initializedFromRecords: true }),

      toggleConfirmedExpense: (date, id) =>
        set((s) => {
          const cur = normalizeConfirmedSelection(s.confirmedExpenses[date]);
          const exists = cur.localIds.includes(id);
          const localIds = exists ? cur.localIds.filter((x) => x !== id) : [...cur.localIds, id];
          const travelIds = (cur.travelIds ?? []).filter((x) => x !== id);
          const sharedIds = (cur.sharedIds ?? []).filter((x) => x !== id);
          const nextMap = { ...s.confirmedExpenses };
          nextMap[date] = { localIds, travelIds, sharedIds, reviewed: true };
          return { confirmedExpenses: nextMap };
        }),

      setConfirmedExpenseScope: (date, id, scope) =>
        set((s) => {
          const cur = normalizeConfirmedSelection(s.confirmedExpenses[date]);
          const localIds = cur.localIds.filter((x) => x !== id);
          const travelIds = (cur.travelIds ?? []).filter((x) => x !== id);
          const sharedIds = (cur.sharedIds ?? []).filter((x) => x !== id);
          if (scope === 'local') localIds.push(id);
          else if (scope === 'travel') {
            localIds.push(id);
            travelIds.push(id);
          } else sharedIds.push(id);
          const nextMap = { ...s.confirmedExpenses };
          nextMap[date] = { localIds, travelIds, sharedIds, reviewed: true };
          return { confirmedExpenses: nextMap };
        }),

      markConfirmedExpenseZero: (date) =>
        set((s) => ({
          confirmedExpenses: {
            ...s.confirmedExpenses,
            [date]: { localIds: [], travelIds: [], sharedIds: [], reviewed: true },
          },
        })),

      clearConfirmedExpenseSelection: (date) =>
        set((s) => {
          const nextMap = { ...s.confirmedExpenses };
          delete nextMap[date];
          return { confirmedExpenses: nextMap };
        }),
    }),
    {
      name: 'calendar-tags',
      version: 4,
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState;
        const state = persistedState as { confirmedExpenses?: unknown };
        return {
          ...state,
          confirmedExpenses: normalizeConfirmedExpenses(state.confirmedExpenses),
        };
      },
      merge: (persistedState, currentState) => {
        const persisted = (persistedState && typeof persistedState === 'object') ? persistedState as { confirmedExpenses?: unknown } : {};
        return {
          ...currentState,
          ...persisted,
          confirmedExpenses: normalizeConfirmedExpenses(persisted.confirmedExpenses),
        };
      },
    },
  ),
);
