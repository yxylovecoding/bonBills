import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClothesCalendar, ClothesDayContext, ClothesItem, ClothesLocation, Outfit, WearRecord, WeatherSnapshot } from './types';
import { SCENES, categoryLabel, wearId } from './types';
import { calendarDestinations, chooseLocation, effectiveContext, recommend, replacePiece, replacements, weatherFor } from './rules';
import { ClothesError, clothesRequest, photoUrl, readLocal, writeLocal } from './client';
import CityPicker from './CityPicker';
import WearEditor, { createWearDraft, readWearDraft, type WearDraft } from './WearEditor';
import { warmthTotals } from './warmth';
import TripPlanner from './TripPlanner';

interface WeatherResult { weather: WeatherSnapshot | null; stale: boolean; error?: string }
interface Props {
  owner: string; items: ClothesItem[]; initial: ClothesDayContext; records: WearRecord[];
  onContext: (context: ClothesDayContext) => void; onRecord: (record: WearRecord) => void; onExpired: () => void;
  onRefresh: () => void; onWardrobe: () => void;
}
export default function Today({ owner, items, initial, records, onContext, onRecord, onExpired, onRefresh, onWardrobe }: Props) {
  const storageKey = `bonclothes:context-draft:${owner}:${initial.date}`;
  const lastCityKey = `bonclothes:last-city:${owner}`;
  const preferenceKey = `bonclothes:location-choice:${owner}`;
  const [context, setContext] = useState(() => {
    const saved = readLocal<ClothesDayContext>(storageKey, initial);
    const choice = readLocal<ClothesLocation | null>(preferenceKey, null);
    return !saved.location && choice && choice.source !== 'geo' ? { ...saved, location: choice } : saved;
  });
  const [dirty, setDirty] = useState(() => Boolean(readLocal(storageKey, null)));
  const [calendar, setCalendar] = useState<ClothesCalendar | null>(null), [calendarError, setCalendarError] = useState('');
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [located, setLocated] = useState<ClothesLocation | null>(null);
  const [lastCity, setLastCity] = useState(() => readLocal<ClothesLocation | null>(lastCityKey, null));
  const [geoError, setGeoError] = useState(''), [geoBusy, setGeoBusy] = useState(false);
  const [cityQuery, setCityQuery] = useState<string | null>(null);
  const [weatherState, setWeatherState] = useState<WeatherResult>({ weather: null, stale: false });
  const [weatherBusy, setWeatherBusy] = useState(false), [weatherRetry, setWeatherRetry] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [conflict, setConflict] = useState<{ revision: string } | null>(null);
  const [manualTemperature, setManualTemperature] = useState(String(context.manualWeather?.temperature ?? 20));
  const [selection, setSelection] = useState<Outfit | null>(null), [index, setIndex] = useState(0), [replace, setReplace] = useState<string | null>(null);
  const [wearEditor, setWearEditor] = useState<WearDraft | null>(null);
  const [hasWearDraft, setHasWearDraft] = useState(() => Boolean(readWearDraft(owner, initial.date)));
  const [history, setHistory] = useState(false), [older, setOlder] = useState<WearRecord[]>([]), [moreHistory, setMoreHistory] = useState(true);
  const contextMutation = useRef(crypto.randomUUID()), calendarRequest = useRef(0), geoRequest = useRef(0);
  const contextRef = useRef(context); contextRef.current = context;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const todayRecords = records.filter((record) => record.date === initial.date).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.confirmedAt.localeCompare(b.confirmedAt));
  const location = chooseLocation(context.location, located, lastCity);
  const effective = useMemo(() => ({ ...effectiveContext(context, calendar), location }), [context, calendar, location]);
  const weather = weatherState.weather;
  const candidates = useMemo(() => recommend(items, effective, weather, records), [items, effective, weather, records]);
  const proposed = selection ?? candidates[index % Math.max(1, candidates.length)];
  const outfit: Outfit | undefined = proposed;
  const outfitWarmth = warmthTotals(outfit?.items ?? []);
  const openWear = (pieces: ClothesItem[] = [], record?: WearRecord) => setWearEditor(readWearDraft(owner, initial.date) ?? createWearDraft(effective, weatherFor(effective, weather), pieces, record));
  const changeContext = (next: Partial<ClothesDayContext>) => {
    setContext((value) => { const updated = { ...value, ...next }; writeLocal(storageKey, updated); return updated; });
    setDirty(true); contextMutation.current = crypto.randomUUID(); setSelection(null); setIndex(0); setError('');
  };
  useEffect(() => {
    if (!dirtyRef.current) {
      const choice = readLocal<ClothesLocation | null>(preferenceKey, null);
      setContext(!initial.location && choice && choice.source !== 'geo' ? { ...initial, location: choice } : initial);
    }
  }, [initial, preferenceKey]);
  // A stale selected outfit must never hide a newly unavailable item.
  useEffect(() => { setSelection(null); setIndex(0); }, [items, weather, effective.scene, effective.active]);
  const refreshCalendar = useCallback(async () => {
    const token = ++calendarRequest.current; setCalendarBusy(true); setCalendarError('');
    try {
      const result = await clothesRequest<ClothesCalendar>('GET', { view: 'calendar', date: initial.date, timezone: initial.timezone });
      if (token === calendarRequest.current) setCalendar(result);
    } catch (cause) {
      if (token === calendarRequest.current) {
        if (cause instanceof ClothesError && cause.status === 401) onExpired();
        setCalendarError('日历更新失败');
      }
    } finally { if (token === calendarRequest.current) setCalendarBusy(false); }
  }, [initial.date, initial.timezone, onExpired]);
  useEffect(() => {
    void refreshCalendar();
    const interval = window.setInterval(() => { if (!document.hidden) void refreshCalendar(); }, 5 * 60000);
    return () => { clearInterval(interval); calendarRequest.current++; };
  }, [refreshCalendar]);
  const locate = useCallback((explicit: boolean) => {
    if (!navigator.geolocation) { setGeoError('当前浏览器无法定位'); return; }
    const token = ++geoRequest.current; setGeoBusy(true); setGeoError('');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (token !== geoRequest.current) return;
      const found: ClothesLocation = { name: '当前位置', latitude: coords.latitude, longitude: coords.longitude, source: 'geo' };
      if (explicit) writeLocal(preferenceKey, found);
      setLocated(found); setGeoBusy(false);
      if (explicit || !contextRef.current.location || contextRef.current.location.source === 'geo') {
        // Automatic refresh never takes priority over a manual selection made while GPS was pending.
        if (!explicit && contextRef.current.location && contextRef.current.location.source !== 'geo') return;
        setContext((value) => { const next = { ...value, location: found }; writeLocal(storageKey, next); return next; });
        setDirty(true); contextMutation.current = crypto.randomUUID();
      }
    }, () => {
      if (token !== geoRequest.current) return;
      setGeoBusy(false); setGeoError('定位失败，请选择城市');
      setLocated(null);
      if (contextRef.current.location?.source === 'geo') {
        setContext((value) => ({ ...value, location: null }));
      }
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }, [storageKey, preferenceKey]);
  useEffect(() => {
    let active = true;
    let attempted = false;
    const auto = async () => {
      if (contextRef.current.location && contextRef.current.location.source !== 'geo') return;
      let permission: PermissionState | undefined;
      try { permission = (await navigator.permissions?.query({ name: 'geolocation' }))?.state; } catch { /* Safari may not expose Permissions API. */ }
      if (!active) return;
      if (permission === 'denied') { setGeoError('定位未授权，请选择城市'); return; }
      if (permission === 'granted' || !attempted) { attempted = true; locate(false); }
    };
    void auto(); window.addEventListener('focus', auto);
    return () => { active = false; geoRequest.current++; window.removeEventListener('focus', auto); };
  }, [locate]);
  useEffect(() => {
    if (!location) { setWeatherState({ weather: null, stale: false }); return; }
    const abort = new AbortController(); let active = true;
    // Never show weather from the previous destination while a request is pending.
    setWeatherState((value) => value.weather && Math.abs(value.weather.latitude - location.latitude) < .001
      && Math.abs(value.weather.longitude - location.longitude) < .001 ? value : { weather: null, stale: false });
    const load = async () => {
      setWeatherBusy(true);
      try {
        const result = await clothesRequest<WeatherResult>('GET', { view: 'weather', date: initial.date, timezone: initial.timezone,
          latitude: location.latitude, longitude: location.longitude }, abort.signal);
        if (active) setWeatherState(result);
      } catch (cause) {
        if (active) {
          if (cause instanceof ClothesError && cause.status === 401) onExpired();
          setWeatherState((value) => ({ ...value, stale: true, error: '天气更新失败' }));
        }
      } finally { if (active) setWeatherBusy(false); }
    };
    void load(); const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30 * 60000);
    const focus = () => setWeatherRetry((value) => value + 1);
    window.addEventListener('focus', focus);
    return () => { active = false; abort.abort(); clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [location?.latitude, location?.longitude, initial.date, initial.timezone, weatherRetry, onExpired]);
  async function saveContext() {
    setBusy(true); setError('');
    const mutationId = contextMutation.current;
    try {
      const { value } = await clothesRequest<{ value: ClothesDayContext }>('POST', { action: 'save-context', context,
        mutationId });
      if (mutationId === contextMutation.current) { setContext(value); setDirty(false); writeLocal(storageKey, null); }
      else setContext((current) => { const next = { ...current, revision: value.revision }; writeLocal(storageKey, next); return next; });
      onContext(value);
    } catch (cause) { failed(cause); } finally { setBusy(false); }
  }
  function failed(cause: unknown) {
    if (cause instanceof ClothesError) {
      if (cause.status === 401) onExpired();
      if (cause.status === 409 && !cause.wardrobeChanged) setConflict({ revision: (cause.current as { revision?: string })?.revision ?? '' });
      if (cause.wardrobeChanged) { onRefresh(); setSelection(null); }
    }
    setError(cause instanceof Error ? cause.message : '保存失败，请重试');
  }
  const historyRecords = [...new Map([...records, ...older].map((record) => [wearId(record), record])).values()].sort((a, b) => b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? ''));
  async function loadHistory() {
    const last = historyRecords.at(-1)?.date; if (!last) return;
    setBusy(true); setError('');
    try {
      const date = new Date(Date.parse(`${last}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
      const result = await clothesRequest<{ records: WearRecord[] }>('GET', { view: 'history', date });
      setOlder((value) => [...value, ...result.records]); setMoreHistory(new Set(result.records.map((record) => record.date)).size === 30);
    } catch (cause) { failed(cause); } finally { setBusy(false); }
  }
  const destinations = calendarDestinations(calendar?.events ?? []);
  const replaceItem = outfit?.items.find((item) => item.id === replace);
  return <>
    <section className="clothes-today-records" aria-label="今天穿了什么">
      <div className="clothes-row clothes-section-heading"><h2>今天穿了什么</h2><button className="life-primary" onClick={() => openWear()}>{hasWearDraft ? '继续记录' : todayRecords.length ? '再记一套' : '记录穿搭'}</button></div>
      {todayRecords.length ? todayRecords.map((record, i) => <article className="clothes-daily-record" key={wearId(record)}>
        <div className="clothes-row"><strong>{record.time || `第 ${i + 1} 套`}{record.purpose ? ` · ${record.purpose}` : ''}</strong><button className="clothes-link" onClick={() => openWear([], record)}>编辑穿搭</button></div>
        <p className="clothes-muted">室内：{record.indoor ?? '未记录'} · 室外：{record.outdoor ?? '未记录'}</p>
        <div className="clothes-history-pieces">{record.items.map((item) => <figure key={item.id}><img loading="lazy" src={photoUrl(item.photoId)} alt={item.name} /><figcaption>{item.name}</figcaption></figure>)}</div>
      </article>) : <p className="clothes-muted">今天还没有记录穿搭</p>}
    </section>
    <section className="clothes-context" aria-label="当天条件">
      <div className="clothes-row"><div className="clothes-location"><span className="clothes-label">地点</span><button onClick={() => setCityQuery('')}>{location?.name ?? '选择城市'} <span aria-hidden="true">⌄</span></button></div>
        <button className="clothes-link" disabled={geoBusy || busy} onClick={() => locate(true)}>{geoBusy ? '定位中…' : '定位'}</button></div>
      {geoError && <p className="clothes-status" role="status">{geoError}</p>}
      {destinations.length > 0 && <div className="clothes-destinations"><span className="clothes-label">日程地点</span>{destinations.map((destination) => <button key={destination} onClick={() => setCityQuery(destination)}>{destination}</button>)}</div>}
      <div className="clothes-weather">
        {weather ? <><strong>{Math.round(weather.temperature)}°</strong><div><span>体感 {Math.round(weather.apparent)}° · {Math.round(weather.min)}–{Math.round(weather.max)}°</span><span>{weather.precipitation > 0 ? `降水 ${weather.precipitation} mm` : '无雨'} · 风 {Math.round(weather.wind)} km/h</span></div></>
          : <span className="clothes-muted">{weatherBusy ? '天气加载中…' : location ? '暂无天气' : '请选择城市'}</span>}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>
      </div>
      {(weatherState.error || weatherState.stale) && <div className="clothes-status" role="status">天气更新失败 <button disabled={weatherBusy} onClick={() => setWeatherRetry((v) => v + 1)}>重试</button></div>}
      {weather && <div className="clothes-updated">{weatherState.stale ? '旧天气 · ' : ''}{new Date(weather.fetchedAt).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 更新</div>}
      <fieldset disabled={busy} className="clothes-fields clothes-context-fields">
        <label>场景<select aria-label="场景" value={effective.scene ?? ''} onChange={(e) => changeContext({ scene: e.target.value as ClothesDayContext['scene'] || null })}><option value="">待选择</option>{SCENES.map((scene) => <option key={scene}>{scene}</option>)}</select></label>
        <label>运动／多走路<select aria-label="运动或多走路" value={effective.active === null ? '' : String(effective.active)} onChange={(e) => changeContext({ active: e.target.value === '' ? null : e.target.value === 'true' })}><option value="">待选择</option><option value="false">没有</option><option value="true">有运动或走很多路</option></select></label>
        <label className="clothes-check clothes-full"><input type="checkbox" checked={Boolean(context.manualWeather)} onChange={(e) => changeContext({ manualWeather: e.target.checked ? { temperature: Number(manualTemperature), rain: false } : null })} />手填天气</label>
        {context.manualWeather && <><label>温度 °C<input aria-label="温度" type="number" min={-60} max={60} value={manualTemperature} onChange={(e) => { setManualTemperature(e.target.value); if (e.target.value !== '' && Number.isFinite(Number(e.target.value))) changeContext({ manualWeather: { ...context.manualWeather!, temperature: Number(e.target.value) } }); }} /></label><label>雨况<select aria-label="雨况" value={String(context.manualWeather.rain)} onChange={(e) => changeContext({ manualWeather: { ...context.manualWeather!, rain: e.target.value === 'true' } })}><option value="false">无雨</option><option value="true">有雨</option></select></label></>}
      </fieldset>
      <div className="clothes-row clothes-calendar-status"><span className={calendarError ? 'clothes-error' : 'clothes-muted'}>{calendarBusy ? '日历更新中…' : calendarError || (calendar?.connected ? `日程 ${calendar.events.length} 项` : 'Outlook 未连接')}</span>
        <div><button className="clothes-link" disabled={calendarBusy} onClick={() => void refreshCalendar()}>{calendarError ? '重试' : '刷新日历'}</button>{dirty && <button className="clothes-save" disabled={busy || Boolean(conflict) || (Boolean(context.manualWeather) && (manualTemperature === '' || Number(manualTemperature) < -60 || Number(manualTemperature) > 60))} onClick={() => void saveContext()}>{busy ? '保存中…' : '保存条件'}</button>}</div></div>
      {calendar?.events.length ? <details className="clothes-events"><summary>当日日程</summary>{calendar.events.map((event, i) => <div key={i}><span>{event.allDay ? '全天' : new Date(event.startDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span>{event.title}{event.location && <small>{event.location}</small>}</span></div>)}</details> : null}
    </section>
    <section className="clothes-outfit" aria-label="今日穿搭">
      <div className="clothes-row clothes-section-heading"><h2>穿搭推荐</h2><button className="clothes-link" disabled={candidates.length < 2 || busy} onClick={() => { setSelection(null); setIndex((v) => v + 1); setReplace(null); }}>换一套</button></div>
      {outfit?.items.length ? <div className="clothes-grid clothes-outfit-grid">{outfit.items.map((item) => <article className="clothes-card" key={item.id}><img loading="lazy" src={photoUrl(item.photoId)} alt={item.name} /><div className="clothes-card-caption"><div><strong>{item.name}</strong><span>{categoryLabel(item.category)}</span></div>{<button aria-label={`替换${item.name}`} onClick={() => setReplace(replace === item.id ? null : item.id)}>替换</button>}</div></article>)}</div>
        : <div className="clothes-empty">{!items.length ? <><p>衣柜还是空的</p><button className="clothes-link" onClick={onWardrobe}>添加衣物</button></> : !effective.scene || effective.active === null ? '请补全当天条件' : !weatherFor(effective, weather) ? '请选择城市或手填天气' : '暂无合适衣物'}</div>}
      {outfit?.missing.length ? <p className="clothes-status">缺少：{outfit.missing.join('、')}</p> : null}
      {replaceItem && <div className="clothes-replacements"><div className="clothes-row"><span>替换{categoryLabel(replaceItem.category)}</span><button onClick={() => setReplace(null)}>收起</button></div><div className="clothes-grid">{replacements(replaceItem, outfit!, items, effective, weather).map((item) => <button key={item.id} onClick={() => { setSelection(replacePiece(outfit!, replaceItem.id, item, items, effective, weather)); setReplace(null); }}><img loading="lazy" src={photoUrl(item.photoId)} alt={item.name} /><span>{item.name}</span></button>)}</div>{!replacements(replaceItem, outfit!, items, effective, weather).length && <p className="clothes-muted">暂无可替换衣物</p>}</div>}
      {outfit?.items.length ? <p className="clothes-muted">上身 {outfitWarmth.upper}°C · 下身 {outfitWarmth.lower}°C</p> : null}
      <div className="clothes-confirm"><button className="life-primary" disabled={!outfit?.items.length} onClick={() => openWear(outfit?.items)}>记录这套穿搭</button></div>
    </section>
    {error && <div className="life-error" role="alert">{error}</div>}
    {conflict && <div className="life-conflict"><button onClick={() => { changeContext({ revision: conflict.revision }); setConflict(null); setError(''); }}>保留当前内容，重新保存</button></div>}
    <TripPlanner owner={owner} date={initial.date} timezone={initial.timezone} items={items} records={records} onExpired={onExpired} onRefresh={onRefresh} />
    <section className="clothes-history"><button className="clothes-row" aria-expanded={history} onClick={() => setHistory(!history)}><span>穿搭历史</span><span>{history ? '−' : '+'}</span></button>
      {history && <div>{historyRecords.length ? historyRecords.map((record) => <article key={wearId(record)}><div className="clothes-row"><strong>{record.date} {record.time} {record.purpose}</strong><span>{record.context.location?.name}</span></div><p>室内：{record.indoor ?? '未记录'} · 室外：{record.outdoor ?? '未记录'}</p><div className="clothes-history-pieces">{record.items.map((item) => <figure key={item.id}><img loading="lazy" src={photoUrl(item.photoId)} alt={item.name} /><figcaption>{item.name}</figcaption></figure>)}</div></article>) : <p className="clothes-muted">暂无记录</p>}{moreHistory && historyRecords.length >= 30 && <button disabled={busy} onClick={() => void loadHistory()}>更早记录</button>}</div>}
    </section>
    {wearEditor && <WearEditor initial={wearEditor} owner={owner} items={items} onSaved={(record) => { onRecord(record); setWearEditor(null); setHasWearDraft(false); }} onClose={() => { setWearEditor(null); setHasWearDraft(Boolean(readWearDraft(owner, initial.date))); }} onExpired={onExpired} onRefresh={onRefresh} />}
    {cityQuery !== null && <CityPicker initial={cityQuery} onClose={() => setCityQuery(null)} onSelect={(city) => {
      geoRequest.current++; setGeoBusy(false); setGeoError(''); setCityQuery(null); setLastCity(city); writeLocal(lastCityKey, city);
      writeLocal(preferenceKey, city);
      changeContext({ location: city });
    }} />}
  </>;
}
