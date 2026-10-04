import { useEffect, useRef, useState } from 'react';
import { SKIN_SEASONS, SKIN_STATES, SKIN_TIMES, emptySkinDay, parseSkinSettings,
  type SkinProduct, type SkinSettings, type SkinState } from '../utils/lifeSkin';
import { LifeError, lifeRequest } from './client';

function TagChoices<T extends string>({ label, options, value, disabled, onChange }: {
  label: string; options: Record<T, string>; value: T[]; disabled: boolean; onChange: (next: T[]) => void;
}) {
  return <fieldset className="life-skin-choices" disabled={disabled}><legend>{label}</legend><div>
    {(Object.entries(options) as [T, string][]).map(([key, name]) => <button type="button" key={key} aria-pressed={value.includes(key)}
      onClick={() => onChange(value.includes(key) ? value.filter((item) => item !== key) : [...value, key])}>{name}</button>)}
  </div></fieldset>;
}

export default function LifeSkinSettings({ initial, year, onSave, onClose, onExpired }: {
  initial: SkinSettings; year: number; onSave: (settings: SkinSettings) => void; onClose: () => void; onExpired: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(initial);
  const [tab, setTab] = useState<'plans' | 'products'>('plans');
  const [state, setState] = useState<SkinState>('acne');
  const [item, setItem] = useState<SkinProduct | null>(null);
  const [tags, setTags] = useState('');
  const [filter, setFilter] = useState<'all' | 'medication' | 'skincare'>('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const mutation = useRef(crypto.randomUUID());
  const attempted = useRef(false);
  const dirty = draft !== initial || Boolean(item);
  const plan = draft.plans[state];
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  function change(next: SkinSettings) { setDraft(next); mutation.current = crypto.randomUUID(); setDiscarding(false); setError(''); }
  function close() { if (busy) return; if (dirty && !discarding) { setDiscarding(true); return; } onClose(); }
  async function save() {
    if (busy || attempted.current || item) return;
    setError(''); setBusy(true); attempted.current = true;
    try {
      const settings = parseSkinSettings(draft);
      const result = await lifeRequest<{ settings: SkinSettings }>('POST', { action: 'save-skin-settings', year, settings, mutationId: mutation.current });
      onSave(result.settings);
    } catch (cause) {
      if (cause instanceof LifeError && cause.status === 401) onExpired();
      setError(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally { setBusy(false); attempted.current = false; }
  }
  function editProduct(product?: SkinProduct) {
    setItem(product ?? { id: crypto.randomUUID(), name: '', kind: 'skincare', active: true, states: [], seasons: [], times: [], tags: [], notes: '' });
    setTags(product?.tags.join('，') ?? ''); setError(''); setDiscarding(false);
  }
  function finishProduct() {
    if (!item) return;
    const product = { ...item, tags: tags.split(/[,，、\n]/).map((value) => value.trim()).filter(Boolean) };
    const next = { ...draft, products: draft.products.some((value) => value.id === item.id)
      ? draft.products.map((value) => value.id === item.id ? product : value) : [...draft.products, product] };
    try { change(parseSkinSettings(next)); setItem(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '用品信息无效'); }
  }
  const products = draft.products.filter((product) => (filter === 'all' || product.kind === filter)
    && [product.name, ...product.tags, ...product.states.map((key) => SKIN_STATES[key]), ...product.seasons.map((key) => SKIN_SEASONS[key])]
      .join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  return <dialog className="life-dialog life-skin-settings" ref={dialog} onCancel={(event) => { event.preventDefault(); close(); }} aria-labelledby="life-skin-title">
    <form onSubmit={(event) => { event.preventDefault(); if (item) finishProduct(); else void save(); }}>
      <div className="life-editor-heading"><h2 id="life-skin-title">皮肤护理</h2><span>{dirty ? '未保存' : '个人方案'}</span></div>
      <nav className="life-skin-section-tabs" aria-label="皮肤设置"><button type="button" disabled={busy || Boolean(item)} aria-pressed={tab === 'plans'} onClick={() => setTab('plans')}>护理方案</button>
        <button type="button" disabled={busy || Boolean(item)} aria-pressed={tab === 'products'} onClick={() => setTab('products')}>在用清单 · {draft.products.filter((value) => value.active).length}</button></nav>
      {tab === 'plans' && <>
        <fieldset className="life-skin-choices" disabled={busy}><legend>皮肤状态</legend><div>{(Object.entries(SKIN_STATES) as [SkinState, string][]).map(([key, label]) =>
          <button type="button" key={key} aria-pressed={state === key} onClick={() => setState(key)}>{label}</button>)}</div></fieldset>
        {state === 'acne' && <label className="life-check"><input type="checkbox" disabled={busy} checked={plan.careFrom === 'damaged'} onChange={(event) => {
          const { careFrom: _careFrom, ...ownPlan } = plan;
          change({ ...draft, plans: { ...draft.plans, acne: event.target.checked ? { ...plan, careFrom: 'damaged' } : ownPlan } });
        }} />护肤品沿用受损状态</label>}
        {plan.days.length > 1 && <label className="life-check"><input type="checkbox" disabled={busy} checked={plan.repeat ?? false} onChange={(event) =>
          change({ ...draft, plans: { ...draft.plans, [state]: { ...plan, repeat: event.target.checked } } })} />循环方案</label>}
        {plan.days.map((day, index) => <fieldset className="life-skin-plan-day" key={index} disabled={busy}><legend>第 {index + 1} 天</legend>
          <div className="life-fields">{(['medication', 'morningMedication', 'eveningMedication', 'notes'] as const).map((key) => <label key={key}>
            {{ medication: '用药（未分早晚）', morningMedication: '早间用药', eveningMedication: '晚间用药', notes: '应对方法' }[key]}
            <input maxLength={500} value={day[key]} onChange={(event) => change({ ...draft, plans: { ...draft.plans, [state]: { ...plan,
              days: plan.days.map((value, i) => i === index ? { ...value, [key]: event.target.value } : value) } } })} /></label>)}</div>
          {plan.days.length > 1 && <button type="button" className="life-skin-text-action" onClick={() => change({ ...draft, plans: { ...draft.plans,
            [state]: { ...plan, days: plan.days.filter((_, i) => i !== index) } } })}>移除第 {index + 1} 天</button>}
        </fieldset>)}
        <button type="button" className="life-skin-text-action" disabled={busy || plan.days.length >= 14} onClick={() => change({ ...draft, plans: { ...draft.plans,
          [state]: { ...plan, days: [...plan.days, emptySkinDay()] } } })}>＋ 添加一天</button>
        <div className="life-skin-care-list"><span>护肤品 · {plan.careFrom ? '沿用受损' : SKIN_STATES[state]}</span>
          {draft.products.filter((product) => product.active && product.kind === 'skincare' && (!product.states.length || product.states.includes(plan.careFrom ?? state)))
            .map((product) => <p key={product.id}>{product.name}<small>{product.seasons.length ? product.seasons.map((key) => SKIN_SEASONS[key]).join(' / ') : '全年'}</small></p>)}
          <button type="button" disabled={busy} className="life-skin-text-action" onClick={() => { setFilter('skincare'); setTab('products'); }}>管理护肤品与季节</button>
        </div>
      </>}
      {tab === 'products' && <>
        {!item ? <>
          <div className="life-skin-product-toolbar"><label className="life-field">筛选<select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
            <option value="all">全部用品</option><option value="medication">药品</option><option value="skincare">护肤品</option></select></label>
            <label className="life-field">搜索<input value={query} placeholder="名称或标签" onChange={(event) => setQuery(event.target.value)} /></label>
            <button type="button" disabled={busy || draft.products.length >= 100} onClick={() => editProduct()}>＋ 添加用品</button></div>
          <ul className="life-skin-products">{products.map((product) => <li key={product.id} className={product.active ? '' : 'is-paused'}>
            <div><strong>{product.name}</strong><span className="life-skin-product-kind">{product.kind === 'medication' ? '药品' : '护肤品'} · {product.active ? '在用' : '停用'}</span>
              <div className="life-skin-tags">{[...new Set([...product.states.map((key) => SKIN_STATES[key]), ...product.seasons.map((key) => SKIN_SEASONS[key]), ...product.times.map((key) => SKIN_TIMES[key]), ...product.tags])]
                .map((label) => <span key={label}>{label}</span>)}</div>{product.notes && <p>{product.notes}</p>}</div>
            <div className="life-skin-product-actions"><button type="button" disabled={busy} aria-label={`编辑${product.name}`} onClick={() => editProduct(product)}>编辑</button>
              <button type="button" disabled={busy} aria-label={`${product.active ? '停用' : '启用'}${product.name}`} onClick={() => change({ ...draft,
                products: draft.products.map((value) => value.id === product.id ? { ...value, active: !value.active } : value) })}>{product.active ? '停用' : '启用'}</button></div>
          </li>)}</ul>
          {!products.length && <p className="life-empty-state">暂无用品</p>}
        </> : <div className="life-skin-product-editor">
          <div className="life-fields"><label>用品名称<input autoFocus required maxLength={100} disabled={busy} value={item.name} onChange={(event) => setItem({ ...item, name: event.target.value })} /></label>
            <label className="life-field">类型<select disabled={busy} value={item.kind} onChange={(event) => setItem({ ...item, kind: event.target.value as SkinProduct['kind'] })}><option value="skincare">护肤品</option><option value="medication">药品</option></select></label></div>
          <TagChoices label="状态标签" options={SKIN_STATES} value={item.states} disabled={busy} onChange={(states) => setItem({ ...item, states })} />
          <TagChoices label="季节标签 · 不选为全年" options={SKIN_SEASONS} value={item.seasons} disabled={busy} onChange={(seasons) => setItem({ ...item, seasons })} />
          <TagChoices label="时段标签" options={SKIN_TIMES} value={item.times} disabled={busy} onChange={(times) => setItem({ ...item, times })} />
          <label className="life-field">自定义标签<input maxLength={310} disabled={busy} placeholder="例如：保湿，修护，局部使用" value={tags} onChange={(event) => setTags(event.target.value)} /></label>
          <label className="life-field">备注<input maxLength={500} disabled={busy} value={item.notes} onChange={(event) => setItem({ ...item, notes: event.target.value })} /></label>
          <label className="life-check"><input type="checkbox" disabled={busy} checked={item.active} onChange={(event) => setItem({ ...item, active: event.target.checked })} />正在使用</label>
          <div className="life-editor-actions"><button type="button" onClick={() => { setItem(null); setError(''); }}>取消编辑</button><button type="submit" className="life-primary">完成编辑</button></div>
        </div>}
      </>}
      {error && <p role="alert" className="life-error">{error}</p>}
      {!item && <div className="life-editor-actions"><button type="button" disabled={busy} onClick={close}>{discarding ? '放弃修改' : '取消'}</button>
        <button type="submit" className="life-primary" disabled={busy}>{busy ? '保存中…' : '保存设置'}</button></div>}
    </form>
  </dialog>;
}
