import { useCallback, useEffect, useMemo, useState } from 'react';
import LoginPage from '../pages/LoginPage';
import { requestSession, restoreSession } from '../utils/authClient';
import type { ClothesData, ClothesDayContext, ClothesItem, ClothesLocation, WearRecord } from './types';
import { CATEGORIES, wearId } from './types';
import { deviceDate, emptyContext, totalWearCounts } from './rules';
import { addTripDays } from './tripRules';
import { ClothesError, clothesRequest, photoUrl, readLocal, writeLocal } from './client';
import ItemEditor, { newItem, readItemDraft, type ItemDraft } from './ItemEditor';
import { itemCategories, outfitPairCounts, updatePairCounts } from './pairing';
import { itemWarmth } from './warmth';
import Today from './Today';
import SavedOutfits from './SavedOutfits';
import WearEditor, { readWearDraftAt, readWearDraft, wearDraftKey, type WearDraft } from './WearEditor';
import InstallApp from '../components/InstallApp';
import { APP_LINKS } from '../utils/apps';
import '../life/life.css';
import './clothes.css';

let sessionPromise: ReturnType<typeof restoreSession> | undefined;
export default function BonClothes() {
  const [status, setStatus] = useState<'loading' | 'login' | 'ready' | 'error'>('loading');
  const [owner, setOwner] = useState('');
  const expired = useCallback(() => setStatus('login'), []);
  useEffect(() => {
    let active = true;
    sessionPromise ??= restoreSession();
    void sessionPromise.then((session) => { if (active) { setOwner(session.username || 'legacy'); setStatus(session.authenticated ? 'ready' : 'login'); } })
      .catch(() => { sessionPromise = undefined; if (active) setStatus('error'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (status !== 'ready') return;
    let active = true;
    const check = () => void requestSession().then((session) => {
      if (active && (!session.authenticated || (session.username || 'legacy') !== owner)) expired();
    }).catch(() => undefined);
    const storage = (event: StorageEvent) => { if (event.key?.endsWith('logout-at') || event.key === 'bonbills-auth-changed-at') check(); };
    window.addEventListener('focus', check); window.addEventListener('storage', storage);
    return () => { active = false; window.removeEventListener('focus', check); window.removeEventListener('storage', storage); };
  }, [status, owner, expired]);
  return <div className="bonlife bonclothes">{status === 'login' ? <><LoginPage title="BonClothes" icon="/bonclothes.svg" /><div className="app-login-install"><InstallApp app="clothes" /></div></> : status === 'ready'
    ? <ClothesApp owner={owner} onExpired={expired} />
    : <main className="life-loading" role="status">{status === 'loading' ? '加载中…' : <>暂时无法连接<button onClick={() => window.location.reload()}>重试</button></>}</main>}</div>;
}

function ClothesApp({ owner, onExpired }: { owner: string; onExpired: () => void }) {
  const [clock, setClock] = useState(() => ({ date: deviceDate(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  const { date: today, timezone } = clock;
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayLocation, setDayLocation] = useState<ClothesLocation | null>(null);
  const date = selectedDate ?? today;
  const tomorrow = date === addTripDays(today, 1), past = date < today;
  const [tab, setTab] = useState<'today' | 'wardrobe' | 'outfits'>('today');
  const [size, setSize] = useState(() => readLocal<'small' | 'medium' | 'large'>(`bonclothes:view:${owner}`, 'medium'));
  const [category, setCategory] = useState('全部'), [status, setStatus] = useState('全部状态');
  const [data, setData] = useState<ClothesData | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0), [editor, setEditor] = useState<ItemDraft | null>(null);
  const [hasDraft, setHasDraft] = useState(() => Boolean(readItemDraft(owner)));
  const [wearEditor, setWearEditor] = useState<{ draft: WearDraft; storageKey: string } | null>(null);
  const [hasWearDraft, setHasWearDraft] = useState(() => Boolean(readWearDraft(owner, date)));
  useEffect(() => { setHasWearDraft(Boolean(readWearDraft(owner, date))); }, [owner, date]);
  function openWear(draft: WearDraft) {
    const storageKey = wearDraftKey(owner, draft.context.date) + (draft.revision ? `:${draft.id}` : '');
    setWearEditor({ draft: readWearDraftAt(storageKey) ?? draft, storageKey });
  }
  useEffect(() => {
    const tick = () => { const next = { date: deviceDate(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
      setClock((current) => current.date === next.date && current.timezone === next.timezone ? current : next); };
    const timer = window.setInterval(tick, 30000); window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, []);
  useEffect(() => {
    const abort = new AbortController(); let active = true;
    setLoading(true); setError('');
    void clothesRequest<ClothesData>('GET', { date, timezone }, abort.signal).then((result) => { if (active) setData(result); }).catch((cause) => {
      if (!active) return;
      if (cause instanceof ClothesError && cause.status === 401) onExpired();
      setError(cause instanceof Error ? cause.message : '读取失败，请重试');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; abort.abort(); };
  }, [date, timezone, refresh, onExpired]);
  const context = useMemo(() => data?.context?.date === date ? { ...data.context, timezone } : { ...emptyContext(date, timezone), location: past ? null : dayLocation ?? data?.context?.location ?? null }, [data?.context, date, timezone, dayLocation, past]);
  const onContext = useCallback((next: ClothesDayContext) => setData((current) => current && (next.date === date ? { ...current, context: next } : current)), [date]);
  const onRecord = useCallback((record: WearRecord) => setData((current) => {
    if (!current) return current;
    const previous = [...current.records, ...(current.outfits ?? [])].find((entry) => wearId(entry) === wearId(record));
    const wearCounts = { ...(current.wearCounts ?? totalWearCounts(current.records)) };
    if (previous && previous.kind !== 'styled') for (const item of previous.items) wearCounts[item.id] = Math.max(0, (wearCounts[item.id] ?? 0) - 1);
    if (record.kind !== 'styled') for (const item of record.items) wearCounts[item.id] = (wearCounts[item.id] ?? 0) + 1;
    let pairCounts = current.pairCounts ?? outfitPairCounts([...current.records, ...(current.outfits ?? [])]);
    if (previous) pairCounts = updatePairCounts(pairCounts, previous.items, -1);
    pairCounts = updatePairCounts(pairCounts, record.items, 1);
    return { ...current, wearCounts, pairCounts,
      records: [...(record.kind === 'styled' ? [] : [record]), ...current.records.filter((entry) => wearId(entry) !== wearId(record))],
      outfits: [...(record.kind === 'styled' ? [record] : []), ...(current.outfits ?? []).filter((entry) => wearId(entry) !== wearId(record))],
    };
  }), []);
  function saved(item: ClothesItem) {
    setData((current) => current && ({ ...current, items: [...current.items.filter((old) => old.id !== item.id), ...(!item.deleted ? [item] : [])] }));
    setEditor(null); setHasDraft(false); setRefresh((value) => value + 1);
  }
  const items = (data?.items ?? []).filter((item) => (category === '全部' || (category === '睡衣' ? item.sleepwear : itemCategories(item).some((role) => role === category))) && (status === '全部状态' || item.status === status));
  return <main className="life-shell clothes-shell">
    <header className="life-header"><h1><img src="/bonclothes.svg" alt="" width="27" height="27" />BonClothes</h1><div className="life-header-actions"><a href={APP_LINKS.log.url}>BonLog</a><InstallApp app="clothes" /><button onClick={async () => {
      try { await requestSession({ method: 'DELETE' }); localStorage.setItem('bonclothes-logout-at', String(Date.now())); onExpired(); }
      catch { setError('退出失败，请重试'); }
    }}>退出</button></div></header>
    <div className="life-toolbar"><nav className="life-tabs" aria-label="BonClothes"><button aria-pressed={tab === 'today'} onClick={() => setTab('today')}>今日</button><button aria-pressed={tab === 'wardrobe'} onClick={() => setTab('wardrobe')}>衣柜</button><button aria-pressed={tab === 'outfits'} onClick={() => setTab('outfits')}>搭配</button></nav><input className="clothes-date clothes-date-picker" type="date" aria-label="穿搭日期" min="2000-01-01" max="2100-12-31" value={date} onChange={(e) => { if (e.target.value && e.target.validity.valid) setSelectedDate(e.target.value === today ? null : e.target.value); }} /></div>
    {error && <div className="life-error-banner" role="alert">{error}<button onClick={() => setRefresh((v) => v + 1)}>重试</button></div>}
    {!data ? <div className="clothes-empty" role="status">{loading ? '加载中…' : '暂无数据'}</div>
      : tab === 'today' ? <Today key={`${date}:${timezone}`} owner={owner} items={data.items} initial={context} records={data.records} outfits={data.outfits ?? []} wearCounts={data.wearCounts}
        tomorrow={tomorrow} past={past} onReviewDay={setSelectedDate} onToggleDay={(location) => { setDayLocation(location); setSelectedDate(date === today ? addTripDays(today, 1) : null); }} onContext={onContext} onOpenWear={openWear} hasWearDraft={hasWearDraft} onExpired={onExpired} onRefresh={() => setRefresh((v) => v + 1)} onWardrobe={() => { setTab('wardrobe'); setEditor(readItemDraft(owner) ?? { item: newItem(), photo: '', mutationId: crypto.randomUUID() }); }} />
        : tab === 'outfits' ? <SavedOutfits outfits={data.outfits ?? []} items={data.items} context={context.date === today ? context : { ...emptyContext(today, timezone), location: context.location }} onOpenWear={openWear} hasWearDraft={hasWearDraft} />
        : <section aria-label="衣柜"><div className="clothes-wardrobe-toolbar"><div><select aria-label="衣物分类" value={category} onChange={(e) => setCategory(e.target.value)}>{['全部', ...CATEGORIES, '睡衣'].map((value) => <option key={value}>{value}</option>)}</select><select aria-label="衣物状态" value={status} onChange={(e) => setStatus(e.target.value)}>{['全部状态', '可穿', '收起'].map((value) => <option key={value}>{value}</option>)}</select></div><button className="life-primary" onClick={() => {
          const draft = readItemDraft(owner); setEditor(draft ?? { item: newItem(), photo: '', mutationId: crypto.randomUUID() });
        }}>{hasDraft ? '继续编辑' : '新增衣物'}</button></div>
          <div className="clothes-view" aria-label="衣柜视图"><span>图片大小</span>{([['small', '小'], ['medium', '中'], ['large', '大']] as const).map(([value, label]) => <button key={value} aria-pressed={size === value} onClick={() => { setSize(value); writeLocal(`bonclothes:view:${owner}`, value); }}>{label}</button>)}</div>
          <div className={`clothes-grid clothes-wardrobe-grid clothes-size-${size}`}>{items.map((item) => <button className="clothes-card" key={item.id} onClick={() => {
            const draft = readItemDraft(owner); setEditor(draft ?? { item: { ...item }, photo: '', mutationId: crypto.randomUUID() });
          }}><img loading="lazy" src={photoUrl(item.photoId)} alt={item.name} /><div className="clothes-card-caption"><strong>{item.name}</strong><span>{itemWarmth(item)}°C{item.sleepwear ? ' · 睡衣' : ''}{item.status === '收起' ? ' · 收起' : ''}</span></div></button>)}</div>
          {!items.length && <div className="clothes-empty">{data.items.length ? '暂无符合条件的衣物' : '添加第一件衣物'}</div>}
        </section>}
    <footer className="clothes-footer"><a href={APP_LINKS.bills.url}>BonBills</a><button disabled={loading} onClick={() => setRefresh((v) => v + 1)}>{loading ? '刷新中…' : '刷新'}</button></footer>
    {editor && <ItemEditor initial={editor} owner={owner} onClose={() => { setEditor(null); setHasDraft(Boolean(readItemDraft(owner))); }} onSaved={saved} onExpired={onExpired} />}
    {wearEditor && data && <WearEditor initial={wearEditor.draft} storageKey={wearEditor.storageKey} items={data.items} pairCounts={data.pairCounts ?? outfitPairCounts([...data.records, ...(data.outfits ?? [])])} onSaved={(record) => {
      onRecord(record); setRefresh((v) => v + 1); setWearEditor(null); setHasWearDraft(Boolean(readWearDraft(owner, date))); setTab(record.kind === 'styled' ? 'outfits' : 'today');
      if (record.kind !== 'styled') setSelectedDate(record.date === today ? null : record.date);
    }} onClose={() => { setWearEditor(null); setHasWearDraft(Boolean(readWearDraft(owner, date))); }} onExpired={onExpired} onRefresh={() => setRefresh((v) => v + 1)} />}
  </main>;
}
