import { normalizeBillDetailState, useBillDetailStore } from '../stores/billDetailStore';
import { normalizeConfirmedExpenses, useCalendarStore } from '../stores/calendarStore';
import { DEFAULT_CONFIG, useConfigStore } from '../stores/configStore';
import { normalizeExpenseScopeOverrides, useExpenseScopeOverrideStore } from '../stores/expenseScopeOverrideStore';
import { normalizeMonthlyRecords, useMonthlyStore } from '../stores/monthlyStore';
import { DEFAULT_EXPENSE_SCOPE_HELP_TEXT, usePrefsStore } from '../stores/prefsStore';
import { usePossessionStore } from '../stores/possessionStore';
import { DEFAULT_SNAPSHOT, useSnapshotStore } from '../stores/snapshotStore';
import { useTripStore } from '../stores/tripStore';
import { useSyncStatus } from './syncStatus';
import { loadTickTickSyncStatus, syncTickTickTrips } from './tickTickSync';

const EXPENSE_SCOPE_SYNC_KEY = 'expense-scope-overrides';
const LEGACY_EXPENSE_SCOPE_SYNC_KEY = 'life-period-overrides';

const EMPTY_STATES: Record<string, Record<string, unknown>> = {
  'bill-details': { tagStats: {}, aggregates: {}, expenseItems: {}, incomeItems: {}, hasOverride: false },
  'monthly-records': { records: [] },
  'calendar-tags': { tagMap: {}, initializedFromRecords: false, confirmedExpenses: {} },
  'trip-tags': { tripTags: {}, tripNotes: {}, tripSplits: {} },
  'account-snapshot': { current: DEFAULT_SNAPSHOT, history: [] },
  'app-config': { config: DEFAULT_CONFIG },
  'possessions': { items: [], ignoredBillItemIds: [], tagCategory: {} },
  [EXPENSE_SCOPE_SYNC_KEY]: { overrides: { categories: {}, subcategories: {}, notes: {}, tags: {} } },
  // user-prefs 保留 UI 偏好，不清空
};

type StoreEntry = {
  key: string;
  legacyKeys?: readonly string[];
  getState: () => unknown;
  setState: (partial: Record<string, unknown>) => void;
  subscribe: (listener: () => void) => () => void;
  serialize: () => Record<string, unknown>;
};

// 每个 store 只同步数据字段（与各自 persist 的 partialize 对齐）
const stores: StoreEntry[] = [
  {
    key: 'bill-details',
    getState: () => useBillDetailStore.getState(),
    setState: (p) => useBillDetailStore.setState(normalizeBillDetailState(p)),
    subscribe: (l) => useBillDetailStore.subscribe(l),
    serialize: () => {
      const s = useBillDetailStore.getState();
      return { tagStats: s.tagStats, aggregates: s.aggregates, expenseItems: s.expenseItems, incomeItems: s.incomeItems, hasOverride: s.hasOverride };
    },
  },
  {
    key: 'monthly-records',
    getState: () => useMonthlyStore.getState(),
    setState: (p) => useMonthlyStore.setState({
      ...p,
      records: normalizeMonthlyRecords(p.records),
    }),
    subscribe: (l) => useMonthlyStore.subscribe(l),
    serialize: () => {
      const s = useMonthlyStore.getState();
      return { records: s.records };
    },
  },
  {
    key: 'calendar-tags',
    getState: () => useCalendarStore.getState(),
    setState: (p) => useCalendarStore.setState({ ...p, confirmedExpenses: normalizeConfirmedExpenses(p.confirmedExpenses) }),
    subscribe: (l) => useCalendarStore.subscribe(l),
    serialize: () => {
      const s = useCalendarStore.getState();
      return { tagMap: s.tagMap, initializedFromRecords: s.initializedFromRecords, confirmedExpenses: s.confirmedExpenses };
    },
  },
  {
    key: 'trip-tags',
    getState: () => useTripStore.getState(),
    setState: (p) => useTripStore.setState({
      tripTags: p.tripTags && typeof p.tripTags === 'object' ? p.tripTags as Record<string, string> : {},
      tripNotes: p.tripNotes && typeof p.tripNotes === 'object' ? p.tripNotes as Record<string, string> : {},
      tripSplits: p.tripSplits && typeof p.tripSplits === 'object' ? p.tripSplits as Record<string, true> : {},
    }),
    subscribe: (l) => useTripStore.subscribe(l),
    serialize: () => {
      const s = useTripStore.getState();
      return { tripTags: s.tripTags, tripNotes: s.tripNotes, tripSplits: s.tripSplits };
    },
  },
  {
    key: 'account-snapshot',
    getState: () => useSnapshotStore.getState(),
    setState: (p) => useSnapshotStore.setState(p),
    subscribe: (l) => useSnapshotStore.subscribe(l),
    serialize: () => {
      const s = useSnapshotStore.getState();
      return { current: s.current, history: s.history };
    },
  },
  {
    key: 'app-config',
    getState: () => useConfigStore.getState(),
    setState: (p) => useConfigStore.setState(p),
    subscribe: (l) => useConfigStore.subscribe(l),
    serialize: () => ({ config: useConfigStore.getState().config }),
  },
  {
    key: EXPENSE_SCOPE_SYNC_KEY,
    legacyKeys: [LEGACY_EXPENSE_SCOPE_SYNC_KEY],
    getState: () => useExpenseScopeOverrideStore.getState(),
    setState: (p) => {
      useExpenseScopeOverrideStore.setState({
        overrides: normalizeExpenseScopeOverrides(p),
      } as Parameters<typeof useExpenseScopeOverrideStore.setState>[0]);
    },
    subscribe: (l) => useExpenseScopeOverrideStore.subscribe(l),
    serialize: () => ({ overrides: useExpenseScopeOverrideStore.getState().overrides }),
  },
  {
    key: 'user-prefs',
    getState: () => usePrefsStore.getState(),
    setState: (p) => {
      const legacyHelpKey = 'life' + 'PeriodHelpText';
      const rawHelpText = p.expenseScopeHelpText ?? p[legacyHelpKey];
      const persistedHelpText = typeof rawHelpText === 'string' ? rawHelpText : undefined;
      const expenseScopeHelpText = persistedHelpText && /[短长]/.test(persistedHelpText)
        ? DEFAULT_EXPENSE_SCOPE_HELP_TEXT
        : persistedHelpText;
      const { [legacyHelpKey]: _legacyHelp, ...rest } = p;
      void _legacyHelp;
      usePrefsStore.setState({
        ...rest,
        expenseScopeHelpText: expenseScopeHelpText ?? usePrefsStore.getState().expenseScopeHelpText,
      });
    },
    subscribe: (l) => usePrefsStore.subscribe(l),
    serialize: () => {
      const s = usePrefsStore.getState();
      return {
        tagOrder: s.tagOrder,
        accountOrder: s.accountOrder,
        weekdayTags: s.weekdayTags,
        showPayrollCutoffMarkers: s.showPayrollCutoffMarkers,
        reviewableCategories: s.reviewableCategories,
        expenseScopeHelpText: s.expenseScopeHelpText,
        revealConsumptionWishUsd: s.revealConsumptionWishUsd,
      };
    },
  },
  {
    key: 'possessions',
    getState: () => usePossessionStore.getState(),
    setState: (p) => {
      const current = usePossessionStore.getState();
      usePossessionStore.setState({
        items: Array.isArray(p.items) ? p.items as typeof current.items : current.items,
        ignoredBillItemIds: Array.isArray(p.ignoredBillItemIds)
          ? p.ignoredBillItemIds.map(String)
          : current.ignoredBillItemIds,
        tagCategory: p.tagCategory && typeof p.tagCategory === 'object'
          ? p.tagCategory as typeof current.tagCategory
          : current.tagCategory,
        categoryConfig: p.categoryConfig && typeof p.categoryConfig === 'object'
          ? p.categoryConfig as typeof current.categoryConfig
          : current.categoryConfig,
      });
    },
    subscribe: (l) => usePossessionStore.subscribe(l),
    serialize: () => {
      const s = usePossessionStore.getState();
      return {
        items: s.items,
        ignoredBillItemIds: s.ignoredBillItemIds,
        tagCategory: s.tagCategory,
        categoryConfig: s.categoryConfig,
      };
    },
  },
];

const LS_SECRET_KEY = 'sync-secret';

function getSecret(): string | null {
  // URL 参数优先，读到后写入 sessionStorage 并清除 URL
  // 用 sessionStorage 而非 localStorage：关闭标签页/重开浏览器后密钥不保留
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('key');
    if (fromUrl) {
      sessionStorage.setItem(LS_SECRET_KEY, fromUrl);
      url.searchParams.delete('key');
      window.history.replaceState({}, '', url.toString());
      return fromUrl;
    }
    return sessionStorage.getItem(LS_SECRET_KEY);
  } catch {
    return null;
  }
}


async function fetchServer(secret: string): Promise<Record<string, unknown> | null> {
  const res = await fetch('/api/sync', {
    method: 'GET',
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (res.status === 204) return null;
  if (res.status === 401) throw new Error('UNAUTHORIZED');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function uploadAll(secret: string) {
  await uploadStores(secret, stores);
}

function serializeAllStores() {
  return Object.fromEntries(stores.map((store) => [store.key, store.serialize()]));
}

async function uploadStores(secret: string, selectedStores: readonly StoreEntry[]) {
  const body: Record<string, unknown> = {};
  for (const s of selectedStores) body[s.key] = s.serialize();
  const res = await fetch('/api/sync', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`upload HTTP ${res.status}`);
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

let syncingFromServer = false; // 防止首次 setState 触发回传
let syncPauseDepth = 0;
let activeSecret: string | null = null;
let uploadInFlight: Promise<void> | null = null;
let uploadQueued = false;
let tickTickSyncQueued = false;

export function getActiveSyncSecret(): string | null {
  if (activeSecret) return activeSecret;
  try {
    return sessionStorage.getItem(LS_SECRET_KEY);
  } catch {
    return null;
  }
}

export async function createManualBackup() {
  const secret = getActiveSyncSecret();
  if (!secret) throw new Error('缺少同步密码');
  const res = await fetch('/api/sync-monthly-backup', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(serializeAllStores()),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `HTTP ${res.status}`);
  }
}

export async function triggerUpload() {
  if (!activeSecret) return;
  uploadQueued = true;
  if (uploadInFlight) return uploadInFlight;
  const status = useSyncStatus.getState();
  uploadInFlight = (async () => {
    try {
      status.setStatus('saving');
      while (uploadQueued && activeSecret) {
        uploadQueued = false;
        await uploadAll(activeSecret);
      }
      if (tickTickSyncQueued && activeSecret) {
        tickTickSyncQueued = false;
        void syncTickTickTrips(activeSecret);
      }
      status.setStatus('saved');
      setTimeout(() => {
        if (useSyncStatus.getState().state === 'saved') useSyncStatus.getState().setStatus('idle');
      }, 2000);
    } catch (e) {
      status.setStatus('error', e instanceof Error ? e.message : String(e));
    } finally {
      uploadInFlight = null;
      if (uploadQueued) void triggerUpload();
    }
  })();
  return uploadInFlight;
}

export async function runWithSyncPaused<T>(run: () => Promise<T>): Promise<T> {
  syncPauseDepth += 1;
  try {
    return await run();
  } finally {
    syncPauseDepth = Math.max(0, syncPauseDepth - 1);
  }
}

function startSubscriptions() {
  const debouncedUpload = debounce(() => {
    if (syncingFromServer) return;
    void triggerUpload();
  }, 2000);

  for (const s of stores) {
    s.subscribe(() => {
      if (syncingFromServer || syncPauseDepth > 0) return;
      debouncedUpload();
    });
  }

  const readTripSignature = () => JSON.stringify({
    tagMap: useCalendarStore.getState().tagMap,
    tripTags: useTripStore.getState().tripTags,
    tripNotes: useTripStore.getState().tripNotes,
    tripSplits: useTripStore.getState().tripSplits,
    wishes: (useConfigStore.getState().config.wishes ?? []).map(({ id, name, deadline, linkedTripStartDate, isActive }) =>
      ({ id, name, deadline, linkedTripStartDate, isActive })),
  });
  let tripSignature = readTripSignature();
  const markTickTickSyncNeeded = () => {
    if (syncingFromServer || syncPauseDepth > 0) return;
    const nextSignature = readTripSignature();
    if (nextSignature === tripSignature) return;
    tripSignature = nextSignature;
    tickTickSyncQueued = true;
  };
  useCalendarStore.subscribe(markTickTickSyncNeeded);
  useTripStore.subscribe(markTickTickSyncNeeded);
  useConfigStore.subscribe(markTickTickSyncNeeded);
}

async function startTickTickSync(secret: string) {
  const connected = await loadTickTickSyncStatus(secret);
  if (connected) await syncTickTickTrips(secret);
}

export async function initSync() {
  const status = useSyncStatus.getState();
  const secret = getSecret();
  activeSecret = secret;
  if (!secret) {
    // 无密码访问：清空所有 store（覆盖任何遗留的 localStorage 数据）
    for (const s of stores) {
      const empty = EMPTY_STATES[s.key];
      if (empty) s.setState(empty);
    }
    status.setStatus('offline', '无密码，使用本地存储');
    return;
  }

  try {
    status.setStatus('loading');
    const serverData = await fetchServer(secret);
    if (serverData) {
      // 应用服务端数据到各 store
      syncingFromServer = true;
      const storesMissingFromServer: StoreEntry[] = [];
      const storesNormalizedOnLoad: StoreEntry[] = [];
      for (const s of stores) {
        const legacyVal = s.legacyKeys?.map((key) => serverData[key]).find((val) => val && typeof val === 'object');
        const val = serverData[s.key] ?? legacyVal;
        if (val && typeof val === 'object') {
          s.setState(val as Record<string, unknown>);
          if (JSON.stringify(s.serialize()) !== JSON.stringify(val)) storesNormalizedOnLoad.push(s);
        } else {
          storesMissingFromServer.push(s);
        }
      }
      // 新增 Store 或加载时完成数据迁移后，立即把规范化结果固化到云端。
      const storesToUpload = [...new Set([...storesMissingFromServer, ...storesNormalizedOnLoad])];
      if (storesToUpload.length > 0) {
        await uploadStores(secret, storesToUpload);
      }
      // 下一个 tick 再开订阅，避免刚 setState 触发回传
      setTimeout(() => {
        syncingFromServer = false;
        startSubscriptions();
        void startTickTickSync(secret);
      }, 100);
      status.setStatus('saved', '已从云端同步');
      setTimeout(() => {
        if (useSyncStatus.getState().state === 'saved') {
          useSyncStatus.getState().setStatus('idle');
        }
      }, 2000);
    } else {
      // 首次：上传当前 localStorage 数据到服务端
      status.setStatus('saving', '首次同步，上传本地数据');
      await uploadAll(secret);
      startSubscriptions();
      void startTickTickSync(secret);
      status.setStatus('saved', '首次同步完成');
      setTimeout(() => {
        if (useSyncStatus.getState().state === 'saved') {
          useSyncStatus.getState().setStatus('idle');
        }
      }, 2000);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'UNAUTHORIZED') {
      status.setStatus('offline', '密码错误，重新访问时加 ?key=xxx');
    } else {
      status.setStatus('error', msg);
    }
  }
}
