import { useEffect, useMemo, useRef, useState } from 'react';
import { SCENES, PURPOSES, categoryLabel, type ClothesItem, type ClothesTrip, type ClothesTripPlan, type ClothesTripsData, type Outfit, type TripDayPlan, type TripForecast, type WearRecord } from './types';
import { ClothesError, clothesRequest, photoUrl, readLocal, writeLocal } from './client';
import { newTripPlan, tripDayContext } from './tripRules';
import { recommend, replacePiece, replacements } from './rules';
import CityPicker from './CityPicker';
import OutfitWarmth from './OutfitWarmth';

interface Props { owner: string; date: string; timezone: string; items: ClothesItem[]; records: WearRecord[]; onExpired: () => void; onRefresh: () => void }
export default function TripPlanner(props: Props) {
  const [open, setOpen] = useState(false), [data, setData] = useState<ClothesTripsData | null>(null);
  const [selected, setSelected] = useState(''), [retry, setRetry] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true; const abort = new AbortController(); setBusy(true); setError('');
    void clothesRequest<ClothesTripsData>('GET', { view: 'trips', date: props.date, timezone: props.timezone }, abort.signal)
      .then((value) => { if (active) setData(value); }).catch((cause) => {
        if (!active) return;
        if (cause instanceof ClothesError && cause.status === 401) props.onExpired();
        setError(cause instanceof Error ? cause.message : '出游读取失败');
      }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; abort.abort(); };
  }, [open, retry, props.date, props.timezone, props.onExpired]);
  const trip = data?.trips.find((value) => value.id === selected) ?? data?.trips[0];
  return <section className="clothes-history clothes-trips" aria-label="出行穿搭计划">
    <button className="clothes-row" aria-expanded={open} onClick={() => setOpen(!open)}><span>出行穿搭计划</span><span>{open ? '−' : '+'}</span></button>
    {open && <div className="clothes-trip-content">
      <div className="clothes-row"><span className="clothes-muted">{busy ? '出游加载中…' : error || data?.calendarError || (data?.connected ? '已关联出游' : 'Outlook 未连接')}</span><button disabled={busy} onClick={() => setRetry((v) => v + 1)}>{error || data?.calendarError ? '重试' : '刷新行程'}</button></div>
      {data && !data.trips.length && <p className="clothes-empty">暂无近期出游</p>}
      {trip && <><label className="clothes-trip-select">出游<select aria-label="出游" value={trip.id} onChange={(e) => setSelected(e.target.value)}>{data!.trips.map((value) => <option key={value.id} value={value.id}>{value.title} · {value.startDate}–{value.endDate}</option>)}</select></label>
        <TripEditor key={trip.id} {...props} trip={trip} saved={data!.plans.find((plan) => plan.tripId === trip.id)} onSaved={(plan) => setData((value) => value && ({ ...value, plans: [...value.plans.filter((previous) => previous.tripId !== plan.tripId), plan] }))} />
      </>}
    </div>}
  </section>;
}
interface Draft { plan: ClothesTripPlan; mutationId: string }
function TripEditor({ trip, saved, owner, date: today, timezone, items, records, onExpired, onRefresh, onSaved }: Props & { trip: ClothesTrip; saved?: ClothesTripPlan; onSaved: (plan: ClothesTripPlan) => void }) {
  const storageKey = `bonclothes:trip-draft:${owner}:${trip.id}`;
  const [draft, setDraft] = useState<Draft>(() => readLocal(storageKey, { plan: saved ?? newTripPlan(trip), mutationId: crypto.randomUUID() }));
  const { plan } = draft;
  const [dirty, setDirty] = useState(() => Boolean(readLocal(storageKey, null)));
  const [date, setDate] = useState(trip.dates.find((day) => day >= today) ?? trip.dates[0]), [city, setCity] = useState<string | null>(null);
  const [forecast, setForecast] = useState<TripForecast>({ days: {}, stale: false }), [forecastBusy, setForecastBusy] = useState(false), [retry, setRetry] = useState(0);
  const [index, setIndex] = useState(0), [selection, setSelection] = useState<Outfit | null>(null), [replace, setReplace] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState<string | null>(null);
  const latest = useRef(draft); latest.current = draft;
  const location = plan.location, forecastTimezone = location?.timezone ?? timezone;
  useEffect(() => {
    if (!location) return;
    let active = true; const abort = new AbortController();
    setForecast({ days: {}, stale: false }); setForecastBusy(true);
    void clothesRequest<TripForecast>('GET', { view: 'forecast', date: trip.startDate, endDate: trip.endDate,
      latitude: location.latitude, longitude: location.longitude, timezone: forecastTimezone }, abort.signal)
      .then((value) => { if (active) setForecast(value); }).catch((cause) => {
        if (!active) return;
        if (cause instanceof ClothesError && cause.status === 401) onExpired();
        setForecast({ days: {}, stale: true, error: '预报更新失败' });
      }).finally(() => { if (active) setForecastBusy(false); });
    return () => { active = false; abort.abort(); };
  }, [location?.latitude, location?.longitude, forecastTimezone, trip.startDate, trip.endDate, retry, onExpired]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setRetry((value) => value + 1); };
    const timer = window.setInterval(refresh, 30 * 60000); window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const context = useMemo(() => tripDayContext(trip, plan, date, timezone), [trip, plan, date, timezone]);
  const weather = forecast.days[date] ?? null;
  const candidates = useMemo(() => recommend(items, context, weather, records), [items, context, weather, records]);
  const selectedIds = plan.days[date]?.itemIds;
  const savedItems = selectedIds?.map((id) => items.find((item) => item.id === id)).filter((item): item is ClothesItem => Boolean(item)) ?? [];
  const checked = selectedIds && weather ? recommend(savedItems, context, weather)[0] : null;
  const invalid = Boolean(selectedIds && (savedItems.length !== selectedIds.length || savedItems.some((item) => item.deleted || item.status !== '可穿' || (context.active && !item.active))
    || (checked && checked.items.length !== selectedIds.length)));
  const outfit = selection ?? (selectedIds ? { items: savedItems, missing: checked?.missing ?? [], key: selectedIds.slice().sort().join(':') } : candidates[index % Math.max(1, candidates.length)]);
  const replacement = outfit?.items.find((item) => item.id === replace);
  const datesChanged = plan.startDate !== trip.startDate || plan.endDate !== trip.endDate;
  function change(next: ClothesTripPlan) {
    const value = { plan: next, mutationId: crypto.randomUUID() }; setDraft(value); latest.current = value; writeLocal(storageKey, value); setDirty(true); setError('');
  }
  function changeDay(next: Partial<TripDayPlan>) {
    change({ ...plan, days: { ...plan.days, [date]: { scene: plan.days[date]?.scene ?? null, active: plan.days[date]?.active ?? null, itemIds: null, purpose: plan.days[date]?.purpose ?? null, ...next } } });
    setSelection(null); setIndex(0); setReplace(null);
  }
  async function save() {
    setBusy(true); setError(''); const submitted = draft;
    try {
      const { value } = await clothesRequest<{ value: ClothesTripPlan }>('POST', { action: 'save-trip-plan', mutationId: submitted.mutationId, plan: submitted.plan });
      if (latest.current.mutationId === submitted.mutationId) { setDraft({ plan: value, mutationId: crypto.randomUUID() }); setDirty(false); writeLocal(storageKey, null); }
      onSaved(value);
    } catch (cause) {
      if (cause instanceof ClothesError) {
        if (cause.status === 401) onExpired();
        if (cause.wardrobeChanged) onRefresh();
        else if (cause.status === 409) setConflict((cause.current as ClothesTripPlan | null)?.revision ?? '');
      }
      setError(cause instanceof Error ? cause.message : '计划保存失败');
    } finally { setBusy(false); }
  }
  return <div className="clothes-trip-editor">
    {(trip.archived || datesChanged) && <div className="clothes-status">行程已变更{datesChanged && <button onClick={() => change({ ...plan, title: trip.title, startDate: trip.startDate, endDate: trip.endDate, days: Object.fromEntries(Object.entries(plan.days).filter(([date]) => trip.dates.includes(date))) })}>更新日期</button>}</div>}
    <fieldset disabled={busy}>
      <div className="clothes-row"><span className="clothes-label">目的地</span><button onClick={() => setCity('')}>{location?.name ?? '选择城市'} ⌄</button></div>
      {trip.destinations.length > 0 && <div className="clothes-destinations">{trip.destinations.map((destination) => <button key={destination} onClick={() => setCity(destination)}>{destination}</button>)}</div>}
      <label className="clothes-trip-select">日期<select aria-label="出行日期" value={date} onChange={(e) => { setDate(e.target.value); setSelection(null); setIndex(0); setReplace(null); }}>{trip.dates.map((day) => <option key={day} value={day}>{day}{plan.days[day]?.itemIds ? ' · 已选穿搭' : ''}</option>)}</select></label>
      <div className="clothes-weather">{weather ? <><strong>{Math.round(weather.min)}–{Math.round(weather.max)}°</strong><div><span>体感 {Math.round(weather.apparentMin)}–{Math.round(weather.apparent)}°</span><span>{weather.precipitation > 0 ? `降水 ${weather.precipitation} mm` : '无雨'} · 风 {Math.round(weather.wind)} km/h</span></div></> : <span className="clothes-muted">{forecastBusy ? '预报加载中…' : !location ? '请选择目的地' : forecast.error ? '暂无预报' : '待预报'}</span>}<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a></div>
      {forecast.fetchedAt && <div className="clothes-updated">{forecast.stale ? '旧预报 · ' : ''}{new Date(forecast.fetchedAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 更新</div>}
      <div className="clothes-row clothes-status"><span>{forecast.error}</span><button disabled={!location || forecastBusy} onClick={() => setRetry((v) => v + 1)}>{forecast.error ? '重试预报' : '刷新预报'}</button></div>
      <div className="clothes-fields"><label>场景<select aria-label="出行场景" value={context.scene ?? ''} onChange={(e) => changeDay({ scene: e.target.value as TripDayPlan['scene'] || null })}><option value="">待选择</option>{SCENES.map((scene) => <option key={scene}>{scene}</option>)}</select></label><label>运动／多走路<select aria-label="出行运动或多走路" value={context.active === null ? '' : String(context.active)} onChange={(e) => changeDay({ active: e.target.value === '' ? null : e.target.value === 'true' })}><option value="">待选择</option><option value="false">没有</option><option value="true">有运动或走很多路</option></select></label></div>
      <label className="clothes-trip-select">用途<select aria-label="出行用途" value={plan.days[date]?.purpose ?? ''} onChange={(e) => change({ ...plan, days: { ...plan.days, [date]: { scene: context.scene, active: context.active, itemIds: selectedIds ?? null, purpose: e.target.value as TripDayPlan['purpose'] || null } } })}><option value="">请选择</option>{PURPOSES.filter((purpose) => purpose !== '睡觉').map((purpose) => <option key={purpose}>{purpose}</option>)}</select></label>
      <div className="clothes-row clothes-section-heading"><h3>{date.slice(5).replace('-', '.')} 穿搭</h3><button disabled={candidates.length < 2} onClick={() => { const at = candidates.findIndex((value) => value.key === outfit?.key); const next = (at + 1) % candidates.length; setSelection(candidates[next]); setIndex(next); setReplace(null); }}>换一套</button></div>
      {invalid && <p className="clothes-status">衣物或条件已变更 <button onClick={() => changeDay({ itemIds: null })}>重新选搭</button></p>}
      {outfit?.items.length ? <div className="clothes-grid clothes-outfit-grid">{outfit.items.map((item) => <article className="clothes-card" key={item.id}><img loading="lazy" src={photoUrl(item.photoId)} alt={item.name} /><div className="clothes-card-caption"><strong>{item.name}</strong><button disabled={!weather} onClick={() => setReplace(replace === item.id ? null : item.id)}>替换</button></div></article>)}</div> : <p className="clothes-empty">{!items.length ? '衣柜还是空的' : !context.scene || context.active === null ? '请补全出行条件' : !weather ? '等待目的地预报' : '暂无合适衣物'}</p>}
      {outfit && <OutfitWarmth items={outfit.items} />}
      {outfit?.missing.length ? <p className="clothes-status">缺少：{outfit.missing.join('、')}</p> : null}
      {replacement && outfit && <div className="clothes-replacements"><div className="clothes-row"><span>替换{categoryLabel(replacement.category)}</span><button onClick={() => setReplace(null)}>收起</button></div><div className="clothes-grid">{replacements(replacement, outfit, items, context, weather).map((item) => <button key={item.id} onClick={() => { setSelection(replacePiece(outfit, replacement.id, item, items, context, weather)); setReplace(null); }}><img src={photoUrl(item.photoId)} alt={item.name} /><span>{item.name}</span></button>)}</div></div>}
      <div className="clothes-confirm">{outfit?.items.length ? <button disabled={!weather || !plan.days[date]?.purpose || (!selection && invalid)} onClick={() => changeDay({ scene: context.scene, active: context.active, itemIds: outfit.items.map((item) => item.id) })}>{selectedIds && !selection ? '已选这套' : '选用这套'}</button> : null}{selectedIds && <button onClick={() => changeDay({ itemIds: null })}>取消选择</button>}</div>
    </fieldset>
    {error && <p className="life-error" role="alert">{error}</p>}
    {conflict !== null && <button onClick={() => { change({ ...plan, revision: conflict }); setConflict(null); }}>保留当前内容，重新保存</button>}
    <div className="clothes-row clothes-trip-save"><span className="clothes-muted">已选 {Object.values(plan.days).filter((day) => day.itemIds?.length).length} / {trip.dates.length} 天{!dirty && plan.revision ? ' · 已保存' : ''}</span><button className="life-primary" disabled={!dirty || busy || conflict !== null || datesChanged || Boolean(selectedIds && !plan.days[date]?.purpose)} onClick={() => void save()}>{busy ? '保存中…' : '保存计划'}</button></div>
    {city !== null && <CityPicker initial={city} onClose={() => setCity(null)} onSelect={(location) => { change({ ...plan, location, days: Object.fromEntries(Object.entries(plan.days).map(([date, day]) => [date, { ...day, itemIds: null }])) }); setCity(null); setSelection(null); setIndex(0); }} />}
  </div>;
}
