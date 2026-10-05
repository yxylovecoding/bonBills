import { useCallback, useEffect, useMemo, useState } from 'react';
import LoginPage from '../pages/LoginPage';
import { requestSession, restoreSession } from '../utils/authClient';
import type { ClothesData, ClothesDayContext, ClothesItem, WearRecord } from './types';
import { CATEGORIES, categoryLabel, wearId } from './types';
import { deviceDate, emptyContext } from './rules';
import { ClothesError, clothesRequest, photoUrl, readLocal, writeLocal } from './client';
import ItemEditor, { newItem, readItemDraft, type ItemDraft } from './ItemEditor';
import { itemWarmth } from './warmth';
import Today from './Today';
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
  const { date, timezone } = clock;
  const [tab, setTab] = useState<'today' | 'wardrobe'>('today');
  const [size, setSize] = useState(() => readLocal<'small' | 'medium' | 'large'>(`bonclothes:view:${owner}`, 'medium'));
  const [category, setCategory] = useState('全部'), [status, setStatus] = useState('全部状态');
  const [data, setData] = useState<ClothesData | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0), [editor, setEditor] = useState<ItemDraft | null>(null);
  const [hasDraft, setHasDraft] = useState(() => Boolean(readItemDraft(owner)));
  useEffect(() => {
    const tick = () => { const next = { date: deviceDate(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
      setClock((current) => current.date === next.date && current.timezone === next.timezone ? current : next); };
    const timer = window.setInterval(tick, 30000); window.addEventListener('focus', tick);
    return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, []);
  useEffect(() => {
    const abort = new AbortController(); let active = true;
    setLoading(true); setError('');
    void clothesRequest<ClothesData>('GET', { date }, abort.signal).then((result) => { if (active) setData(result); }).catch((cause) => {
      if (!active) return;
      if (cause instanceof ClothesError && cause.status === 401) onExpired();
      setError(cause instanceof Error ? cause.message : '读取失败，请重试');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; abort.abort(); };
  }, [date, timezone, refresh, onExpired]);
  const context = useMemo(() => data?.context?.date === date ? { ...data.context, timezone } : emptyContext(date, timezone), [data?.context, date, timezone]);
  const onContext = useCallback((next: ClothesDayContext) => setData((current) => current && ({ ...current, context: next })), []);
  const onRecord = useCallback((record: WearRecord) => setData((current) => current && ({ ...current, records: [record, ...current.records.filter((previous) => wearId(previous) !== wearId(record))] })), []);
  function saved(item: ClothesItem) {
    setData((current) => current && ({ ...current, items: [...current.items.filter((old) => old.id !== item.id), ...(!item.deleted ? [item] : [])] }));
    setEditor(null); setHasDraft(false);
  }
  const items = (data?.items ?? []).filter((item) => (category === '全部' || categoryLabel(item.category) === category) && (status === '全部状态' || item.status === status));
  return <main className="life-shell clothes-shell">
    <header className="life-header"><h1><img src="/bonclothes.svg" alt="" width="27" height="27" />BonClothes</h1><div className="life-header-actions"><a href={APP_LINKS.log.url}>BonLog</a><InstallApp app="clothes" /><button onClick={async () => {
      try { await requestSession({ method: 'DELETE' }); localStorage.setItem('bonclothes-logout-at', String(Date.now())); onExpired(); }
      catch { setError('退出失败，请重试'); }
    }}>退出</button></div></header>
    <div className="life-toolbar"><nav className="life-tabs" aria-label="BonClothes"><button aria-pressed={tab === 'today'} onClick={() => setTab('today')}>今日</button><button aria-pressed={tab === 'wardrobe'} onClick={() => setTab('wardrobe')}>衣柜</button></nav><span className="clothes-date">{date.replace(/-/g, '.')}</span></div>
    {error && <div className="life-error-banner" role="alert">{error}<button onClick={() => setRefresh((v) => v + 1)}>重试</button></div>}
    {!data ? <div className="clothes-empty" role="status">{loading ? '加载中…' : '暂无数据'}</div>
      : tab === 'today' ? <Today key={`${date}:${timezone}`} owner={owner} items={data.items} initial={context} records={data.records}
        onContext={onContext} onRecord={onRecord} onExpired={onExpired} onRefresh={() => setRefresh((v) => v + 1)} onWardrobe={() => { setTab('wardrobe'); setEditor(readItemDraft(owner) ?? { item: newItem(), photo: '', mutationId: crypto.randomUUID() }); }} />
        : <section aria-label="衣柜"><div className="clothes-wardrobe-toolbar"><div><select aria-label="衣物分类" value={category} onChange={(e) => setCategory(e.target.value)}>{['全部', ...CATEGORIES].map((value) => <option key={value}>{value}</option>)}</select><select aria-label="衣物状态" value={status} onChange={(e) => setStatus(e.target.value)}>{['全部状态', '可穿', '收起'].map((value) => <option key={value}>{value}</option>)}</select></div><button className="life-primary" onClick={() => {
          const draft = readItemDraft(owner); setEditor(draft ?? { item: newItem(), photo: '', mutationId: crypto.randomUUID() });
        }}>{hasDraft ? '继续编辑' : '新增衣物'}</button></div>
          <div className="clothes-view" aria-label="衣柜视图"><span>图片大小</span>{([['small', '小'], ['medium', '中'], ['large', '大']] as const).map(([value, label]) => <button key={value} aria-pressed={size === value} onClick={() => { setSize(value); writeLocal(`bonclothes:view:${owner}`, value); }}>{label}</button>)}</div>
          <div className={`clothes-grid clothes-wardrobe-grid clothes-size-${size}`}>{items.map((item) => <button className="clothes-card" key={item.id} onClick={() => {
            const draft = readItemDraft(owner); setEditor(draft ?? { item: { ...item }, photo: '', mutationId: crypto.randomUUID() });
          }}><img loading="lazy" src={photoUrl(item.photoId)} alt={item.name} /><div className="clothes-card-caption"><strong>{item.name}</strong><span>{itemWarmth(item)}°C{item.status === '收起' ? ' · 收起' : ''}</span></div></button>)}</div>
          {!items.length && <div className="clothes-empty">{data.items.length ? '暂无符合条件的衣物' : '添加第一件衣物'}</div>}
        </section>}
    <footer className="clothes-footer"><a href={APP_LINKS.bills.url}>BonBills</a><button disabled={loading} onClick={() => setRefresh((v) => v + 1)}>{loading ? '刷新中…' : '刷新'}</button></footer>
    {editor && <ItemEditor initial={editor} owner={owner} onClose={() => { setEditor(null); setHasDraft(Boolean(readItemDraft(owner))); }} onSaved={saved} onExpired={onExpired} />}
  </main>;
}
