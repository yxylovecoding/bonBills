import { normalizeBillDetailState, useBillDetailStore } from '../stores/billDetailStore';
import { normalizeConfirmedExpenses, useCalendarStore } from '../stores/calendarStore';
import { DEFAULT_CONFIG, useConfigStore } from '../stores/configStore';
import { normalizeExpenseScopeOverrides, useExpenseScopeOverrideStore } from '../stores/expenseScopeOverrideStore';
import { normalizeMonthlyRecords, useMonthlyStore } from '../stores/monthlyStore';
import { DEFAULT_EXPENSE_SCOPE_HELP_TEXT, usePrefsStore } from '../stores/prefsStore';
import { DEFAULT_SNAPSHOT, useSnapshotStore } from '../stores/snapshotStore';
import { useSyncStatus } from './syncStatus';

const EXPENSE_SCOPE_SYNC_KEY = 'expense-scope-overrides';
const LEGACY_EXPENSE_SCOPE_SYNC_KEY = 'life-period-overrides';

const EMPTY_STATES: Record<string, Record<string, unknown>> = {
  'bill-details': { tagStats: {}, expenseItems: {}, hasOverride: false },
  'monthly-records': { records: [] },
  'calendar-tags': { tagMap: {}, initializedFromRecords: false, confirmedExpenses: {} },
  'account-snapshot': { current: DEFAULT_SNAPSHOT, history: [] },
  'app-config': { config: DEFAULT_CONFIG },
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
      return { tagStats: s.tagStats, expenseItems: s.expenseItems, hasOverride: s.hasOverride };
    },
  },
  {
    key: 'monthly-records',
    getState: () => useMonthlyStore.getState(),
    setState: (p) => useMonthlyStore.setState({ ...p, records: normalizeMonthlyRecords(p.records) }),
    subscribe: (l) => useMonthlyStore.subscribe(l),
    serialize: () => ({ records: useMonthlyStore.getState().records }),
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
  const body: Record<string, unknown> = {};
  for (const s of stores) body[s.key] = s.serialize();
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
let activeSecret: string | null = null;

export async function triggerUpload() {
  if (!activeSecret) return;
  const status = useSyncStatus.getState();
  try {
    status.setStatus('saving');
    await uploadAll(activeSecret);
    status.setStatus('saved');
    setTimeout(() => {
      if (useSyncStatus.getState().state === 'saved') useSyncStatus.getState().setStatus('idle');
    }, 2000);
  } catch (e) {
    status.setStatus('error', e instanceof Error ? e.message : String(e));
  }
}

function startSubscriptions(secret: string) {
  const status = useSyncStatus.getState();
  const debouncedUpload = debounce(async () => {
    if (syncingFromServer) return;
    try {
      status.setStatus('saving');
      await uploadAll(secret);
      status.setStatus('saved');
      setTimeout(() => {
        if (useSyncStatus.getState().state === 'saved') {
          useSyncStatus.getState().setStatus('idle');
        }
      }, 2000);
    } catch (e) {
      status.setStatus('error', e instanceof Error ? e.message : String(e));
    }
  }, 2000);

  for (const s of stores) {
    s.subscribe(() => debouncedUpload());
  }
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
      for (const s of stores) {
        const legacyVal = s.legacyKeys?.map((key) => serverData[key]).find((val) => val && typeof val === 'object');
        const val = serverData[s.key] ?? legacyVal;
        if (val && typeof val === 'object') {
          s.setState(val as Record<string, unknown>);
        }
      }
      // 下一个 tick 再开订阅，避免刚 setState 触发回传
      setTimeout(() => {
        syncingFromServer = false;
        startSubscriptions(secret);
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
      startSubscriptions(secret);
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
