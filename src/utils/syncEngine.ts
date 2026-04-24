import { useBillDetailStore } from '../stores/billDetailStore';
import { useCalendarStore } from '../stores/calendarStore';
import { useConfigStore } from '../stores/configStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { usePrefsStore } from '../stores/prefsStore';
import { useSnapshotStore } from '../stores/snapshotStore';
import { useSyncStatus } from './syncStatus';

type StoreEntry = {
  key: string;
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
    setState: (p) => useBillDetailStore.setState(p),
    subscribe: (l) => useBillDetailStore.subscribe(l),
    serialize: () => {
      const s = useBillDetailStore.getState();
      return { tagStats: s.tagStats, expenseItems: s.expenseItems, hasOverride: s.hasOverride };
    },
  },
  {
    key: 'monthly-records',
    getState: () => useMonthlyStore.getState(),
    setState: (p) => useMonthlyStore.setState(p),
    subscribe: (l) => useMonthlyStore.subscribe(l),
    serialize: () => ({ records: useMonthlyStore.getState().records }),
  },
  {
    key: 'calendar-tags',
    getState: () => useCalendarStore.getState(),
    setState: (p) => useCalendarStore.setState(p),
    subscribe: (l) => useCalendarStore.subscribe(l),
    serialize: () => {
      const s = useCalendarStore.getState();
      return { tagMap: s.tagMap, initializedFromRecords: s.initializedFromRecords };
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
    key: 'user-prefs',
    getState: () => usePrefsStore.getState(),
    setState: (p) => usePrefsStore.setState(p),
    subscribe: (l) => usePrefsStore.subscribe(l),
    serialize: () => {
      const s = usePrefsStore.getState();
      return { tagOrder: s.tagOrder, accountOrder: s.accountOrder, weekdayTags: s.weekdayTags };
    },
  },
];

const LS_SECRET_KEY = 'sync-secret';

function getSecret(): string | null {
  // URL 参数优先，读到后写入 localStorage 并清除 URL
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('key');
    if (fromUrl) {
      localStorage.setItem(LS_SECRET_KEY, fromUrl);
      url.searchParams.delete('key');
      window.history.replaceState({}, '', url.toString());
      return fromUrl;
    }
    return localStorage.getItem(LS_SECRET_KEY);
  } catch {
    return null;
  }
}

function clearSecret() {
  try { localStorage.removeItem(LS_SECRET_KEY); } catch {}
}

async function fetchServer(secret: string): Promise<Record<string, unknown> | null> {
  const res = await fetch('/api/sync', {
    method: 'GET',
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (res.status === 204) return null;
  if (res.status === 401) {
    clearSecret();
    throw new Error('UNAUTHORIZED');
  }
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
  if (!secret) {
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
        const val = serverData[s.key];
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
