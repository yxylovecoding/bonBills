import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), tickTick: vi.fn() }));
vi.mock('./authClient', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('./tickTickSync', () => ({
  loadTickTickSyncStatus: vi.fn().mockResolvedValue(false),
  syncTickTickTrips: mocks.tickTick,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function loadStores() {
  const [{ useConfigStore }, { useMonthlyStore }, { useCalendarStore }, { useTripStore },
    { useSnapshotStore }, { useBillDetailStore }, { usePrefsStore },
    { usePossessionStore }, { useExpenseScopeOverrideStore }, { useSyncStatus }] = await Promise.all([
    import('../stores/configStore'), import('../stores/monthlyStore'), import('../stores/calendarStore'),
    import('../stores/tripStore'), import('../stores/snapshotStore'), import('../stores/billDetailStore'),
    import('../stores/prefsStore'), import('../stores/possessionStore'), import('../stores/expenseScopeOverrideStore'),
    import('./syncStatus'),
  ]);
  const stores = [useConfigStore, useMonthlyStore, useCalendarStore, useTripStore, useSnapshotStore,
    useBillDetailStore, usePrefsStore, usePossessionStore, useExpenseScopeOverrideStore];
  for (const store of stores) (store.setState as (partial: Record<string, never>) => void)({});
  const cloud = Object.fromEntries(stores.map((store) => {
    const key = store.persist.getOptions().name!;
    return [key, JSON.parse(localStorage.getItem(key)!).state];
  }));
  return { config: useConfigStore, monthly: useMonthlyStore, calendar: useCalendarStore, trips: useTripStore, status: useSyncStatus, cloud };
}

let state: Awaited<ReturnType<typeof loadStores>>;
let engine: typeof import('./syncEngine');
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const uploads = () => mocks.apiFetch.mock.calls.filter(([, init]) => init.method === 'PUT');

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-29T04:00:00Z'));
  vi.clearAllMocks();
  localStorage.clear();
  state = await loadStores();
  state.monthly.setState({ records: [] });
  state.cloud['monthly-records'] = { records: [] };
  mocks.apiFetch.mockImplementation(async (_url, init) => init.method === 'GET'
    ? response(state.cloud) : response({ ok: true }));
  engine = await import('./syncEngine');
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('cached startup synchronization', () => {
  it('支付宝偏好和校正可同步并在刷新后恢复，原始月度账本不受影响', async () => {
    await engine.initSync('bon');
    const { usePrefsStore } = await import('../stores/prefsStore');
    const original = structuredClone(state.monthly.getState().records);
    usePrefsStore.getState().setInvestmentHoldingsView('alipay');
    state.config.getState().setConfig({
      fundConfirmationRules: { 'eastmoney-fund:017641': 2 },
      fundConfirmationOverrides: { 'test-order': { status: 'pending' } },
      alipayActualSnapshots: { '2026-09-29': { date: '2026-09-29', funds: [{ code: '123456', name: '示例基金', totalAmount: 100, holdingProfit: 2, amountKind: 'total', nav: 1.25, navDate: '2026-09-28', pendingOrdersComplete: true }], orders: [] } },
    });
    await vi.advanceTimersByTimeAsync(2000);
    const payload = JSON.parse(uploads().at(-1)![1].body);
    expect(payload['user-prefs'].investmentHoldingsView).toBe('alipay');
    expect(payload['app-config'].config.fundConfirmationRules).toEqual({ 'eastmoney-fund:017641': 2 });
    expect(state.monthly.getState().records).toEqual(original);
    expect(payload['app-config'].config.alipayActualSnapshots).toEqual(state.config.getState().config.alipayActualSnapshots);
    vi.resetModules();
    const refreshedPrefs = (await import('../stores/prefsStore')).usePrefsStore;
    const refreshedConfig = (await import('../stores/configStore')).useConfigStore;
    expect(refreshedPrefs.getState().investmentHoldingsView).toBe('alipay');
    expect(refreshedConfig.getState().config.fundConfirmationOverrides).toEqual({ 'test-order': { status: 'pending' } });
    expect(refreshedConfig.getState().config.alipayActualSnapshots).toEqual(payload['app-config'].config.alipayActualSnapshots);
  });
  const namedTrip = {
    tagMap: { '2027-03-22': 'travel' as const, '2027-03-23': 'travel' as const },
    outlookTravelTitles: { '2027-03-22': '釜山樱花季', '2027-03-23': '釜山樱花季' },
  };

  it('loads every cloud store before creating wishes and uploads the reused association', async () => {
    state.cloud['calendar-tags'] = { ...state.cloud['calendar-tags'], ...namedTrip };
    const original = { id: 'manual', name: '釜山樱花季', targetAmount: 8000, savedAmount: 1000, isActive: true };
    state.cloud['app-config'].config.wishes = [original];
    await engine.initSync('bon');
    const wishes = state.config.getState().config.wishes;
    expect(wishes).toEqual([{ ...original, linkedTripStartDate: '2027-03-22', deadline: '2027-03-21' }]);
    expect(JSON.parse(uploads().at(-1)![1].body)['app-config'].config.wishes).toEqual(wishes);
  });

  it('creates from a local Outlook refresh without opening wishes, saves and avoids duplicates after reload', async () => {
    await engine.initSync('bon');
    mocks.apiFetch.mockClear();
    state.calendar.setState(namedTrip);
    const wishes = state.config.getState().config.wishes;
    expect(wishes).toHaveLength(1);
    expect(wishes![0]).toMatchObject({ name: '釜山樱花季', linkedTripStartDate: '2027-03-22' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(JSON.parse(uploads().at(-1)![1].body)['app-config'].config.wishes).toEqual(wishes);
    vi.resetModules();
    state = await loadStores();
    engine = await import('./syncEngine');
    await engine.initSync('bon');
    expect(state.config.getState().config.wishes).toEqual(wishes);
  });

  it('waits for a bill tag on unnamed dates and retains edits during later calendar changes', async () => {
    await engine.initSync('bon');
    state.calendar.setState({ tagMap: namedTrip.tagMap });
    expect(state.config.getState().config.wishes).toEqual([]);
    state.trips.getState().setTripTag('2027-03-22', '27.3.22 釜山樱花季');
    const [wish] = state.config.getState().config.wishes!;
    state.config.getState().setConfig({ wishes: [{ ...wish, name: '春游', targetAmount: 6000, savedAmount: 800 }] });
    state.calendar.setState(namedTrip);
    expect(state.config.getState().config.wishes).toEqual([{ ...wish, name: '春游', targetAmount: 6000, savedAmount: 800 }]);
  });

  it('defers creation until an import transaction has loaded calendar, tag and wishes', async () => {
    await engine.initSync('bon');
    await engine.runWithSyncPaused(async () => {
      state.calendar.setState(namedTrip);
      expect(state.config.getState().config.wishes).toEqual([]);
      state.trips.getState().setTripTag('2027-03-22', '27.3.22 韩国');
    });
    expect(state.config.getState().config.wishes).toHaveLength(1);
    expect(state.config.getState().config.wishes![0].name).toBe('韩国');
  });

  it('does not create from stale local calendar data before the cloud is loaded', async () => {
    state.calendar.setState(namedTrip);
    await engine.initSync('bon');
    expect(state.config.getState().config.wishes).toEqual([]);
  });

  it('keeps explicit deletion across calendar edits and cloud reload', async () => {
    state.cloud['calendar-tags'] = { ...state.cloud['calendar-tags'], ...namedTrip };
    state.cloud['app-config'].config.dismissedTripWishStarts = { '2027-03-22': true };
    await engine.initSync('bon');
    state.calendar.setState(namedTrip);
    state.config.getState().setConfig({ retireAge: 60 });
    expect(state.config.getState().config.wishes).toEqual([]);
  });

  it('creates a complete local cache when the cloud is empty', async () => {
    localStorage.clear();
    mocks.apiFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await engine.initSync('bon');
    expect(engine.hasSyncCache('bon')).toBe(true);
    expect(uploads()).toHaveLength(1);
    expect(Object.keys(JSON.parse(uploads()[0][1].body))).toHaveLength(9);
  });

  it('keeps local data and avoids writes if a cloud response is malformed', async () => {
    const before = state.config.getState().config;
    mocks.apiFetch.mockResolvedValueOnce(response(null));
    await expect(engine.initSync('bon')).rejects.toThrow();
    expect(state.config.getState().config).toEqual(before);
    expect(uploads()).toHaveLength(0);
  });

  it('only trusts a complete cache belonging to the authenticated owner', async () => {
    expect(engine.hasSyncCache('bon')).toBe(false);
    await engine.initSync('bon');
    expect(engine.hasSyncCache('bon')).toBe(true);
    expect(engine.hasSyncCache('someone-else')).toBe(false);
    localStorage.setItem('app-config', '{');
    expect(engine.hasSyncCache('bon')).toBe(false);
  });

  it('rejects a partial cache even when its owner marker is present', async () => {
    await engine.initSync('bon');
    localStorage.setItem('monthly-records', JSON.stringify({ state: {} }));
    expect(engine.hasSyncCache('bon')).toBe(false);
    localStorage.removeItem('monthly-records');
    expect(engine.hasSyncCache('bon')).toBe(false);
  });

  it('deduplicates startup and merges edits made while the cloud fetch is pending', async () => {
    const get = deferred<Response>();
    mocks.apiFetch.mockImplementation(async (_url, init) => init.method === 'GET' ? get.promise : response({ ok: true }));
    const first = engine.initSync('bon');
    expect(engine.initSync('bon')).toBe(first);
    state.config.getState().setConfig({ retireAge: 60 });
    expect(uploads()).toHaveLength(0);
    state.cloud['app-config'].config.lifeExpectancy = 100;
    get.resolve(response(state.cloud));
    await first;
    expect(state.config.getState().config).toMatchObject({ retireAge: 60, lifeExpectancy: 100 });
    const uploaded = JSON.parse(uploads().at(-1)![1].body);
    expect(uploaded['app-config'].config).toMatchObject({ retireAge: 60, lifeExpectancy: 100 });
    expect(state.status.getState().ready).toBe(true);
    expect(mocks.apiFetch.mock.calls.filter(([, init]) => init.method === 'GET')).toHaveLength(1);
  });

  it('keeps local data after a fetch failure and replays pending edits on retry', async () => {
    mocks.apiFetch.mockResolvedValueOnce(response({}, 503));
    await expect(engine.initSync('bon')).rejects.toThrow('账单加载失败');
    state.config.getState().setConfig({ retireAge: 61 });
    expect(state.status.getState().state).toBe('error');
    expect(uploads()).toHaveLength(0);
    state.cloud['app-config'].config.lifeExpectancy = 101;
    await engine.retrySync();
    expect(state.config.getState().config).toMatchObject({ retireAge: 61, lifeExpectancy: 101 });
    expect(state.status.getState().state).toBe('saved');
  });

  it('restores unsaved changes after a reload without reverting newer cloud fields', async () => {
    mocks.apiFetch.mockResolvedValueOnce(response({}, 503));
    await expect(engine.initSync('bon')).rejects.toThrow();
    state.config.getState().setConfig({ retireAge: 62 });
    const remote = structuredClone(state.cloud);
    remote['app-config'].config.lifeExpectancy = 102;
    vi.resetModules();
    state = await loadStores();
    engine = await import('./syncEngine');
    mocks.apiFetch.mockImplementation(async (_url, init) => init.method === 'GET' ? response(remote) : response({ ok: true }));
    await engine.initSync('bon');
    expect(state.config.getState().config).toMatchObject({ retireAge: 62, lifeExpectancy: 102 });
    expect(localStorage.getItem('bonbills-sync-pending-v1')).toBeNull();
  });

  it('waits for focused drafts to be saved before applying cloud data', async () => {
    const focused = { matches: () => true };
    const document = { activeElement: focused as typeof focused | null, querySelector: () => null };
    vi.stubGlobal('document', document);
    state.cloud['app-config'].config.lifeExpectancy = 103;
    const sync = engine.initSync('bon');
    await vi.advanceTimersByTimeAsync(100);
    expect(state.config.getState().config.lifeExpectancy).not.toBe(103);
    state.config.getState().setConfig({ retireAge: 63 });
    document.activeElement = null;
    await vi.advanceTimersByTimeAsync(100);
    await sync;
    expect(state.config.getState().config).toMatchObject({ retireAge: 63, lifeExpectancy: 103 });
  });

  it('keeps tracking edits made while the initial upload is in flight', async () => {
    const put = deferred<Response>();
    const get = deferred<Response>();
    mocks.apiFetch.mockImplementation(async (_url, init) => init.method === 'GET' ? get.promise : put.promise);
    const sync = engine.initSync('bon');
    state.config.getState().setConfig({ retireAge: 64 });
    get.resolve(response(state.cloud));
    await vi.advanceTimersByTimeAsync(0);
    expect(uploads()).toHaveLength(1);
    state.config.getState().setConfig({ retireAge: 65 });
    mocks.apiFetch.mockResolvedValue(response({ ok: true }));
    put.resolve(response({ ok: true }));
    await sync;
    expect(uploads()).toHaveLength(2);
    expect(JSON.parse(uploads()[1][1].body)['app-config'].config.retireAge).toBe(65);
  });

  it('retains failed uploads and retries only changed stores', async () => {
    await engine.initSync('bon');
    mocks.apiFetch.mockClear();
    state.config.getState().setConfig({ retireAge: 66 });
    mocks.apiFetch.mockResolvedValueOnce(response({}, 503));
    await engine.triggerUpload();
    expect(state.status.getState().state).toBe('error');
    expect(localStorage.getItem('bonbills-sync-pending-v1')).not.toBeNull();
    await engine.retrySync();
    expect(Object.keys(JSON.parse(uploads().at(-1)![1].body))).toEqual(['app-config']);
    expect(localStorage.getItem('bonbills-sync-pending-v1')).toBeNull();
  });

  it('records edits inside a paused import and waits for it before applying the cloud snapshot', async () => {
    const importDone = deferred<void>();
    const importing = engine.runWithSyncPaused(async () => {
      await importDone.promise;
      state.config.getState().setConfig({ retireAge: 67 });
    });
    const sync = engine.initSync('bon');
    await vi.advanceTimersByTimeAsync(100);
    expect(state.status.getState().ready).toBe(false);
    importDone.resolve();
    await importing;
    await vi.advanceTimersByTimeAsync(100);
    await sync;
    expect(state.config.getState().config.retireAge).toBe(67);
  });

  it('finishes import confirmation without waiting on the startup that is waiting on the import', async () => {
    const get = deferred<Response>();
    mocks.apiFetch.mockImplementation(async (_url, init) => init.method === 'GET' ? get.promise : response({ ok: true }));
    const sync = engine.initSync('bon');
    await engine.runWithSyncPaused(async () => {
      state.config.getState().setConfig({ retireAge: 68 });
      await engine.triggerUpload();
    });
    get.resolve(response(state.cloud));
    await sync;
    expect(state.config.getState().config.retireAge).toBe(68);
    expect(JSON.parse(uploads().at(-1)![1].body)['app-config'].config.retireAge).toBe(68);
  });
});
