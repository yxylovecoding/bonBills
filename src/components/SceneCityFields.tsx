import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AppConfig, SceneCity } from '../models/types';
import { clothesRequest } from '../clothes/client';
import { readSceneCity } from '../utils/sceneCities';

export type SceneCitySettings = Pick<AppConfig, 'homeCity' | 'schoolCity'>;
const fields = [{ key: 'homeCity', label: '寄的城市' }, { key: 'schoolCity', label: '居的城市' }] as const;
const buttonStyle: CSSProperties = { border: 'none', borderRadius: 8, padding: '7px 10px', background: '#f1f3f4',
  color: '#1a73e8', fontSize: 12, cursor: 'pointer' };

export default function SceneCityFields({ value, onChange }: {
  value: SceneCitySettings; onChange: (value: SceneCitySettings) => void;
}) {
  const [editing, setEditing] = useState<keyof SceneCitySettings | null>(null);
  const [query, setQuery] = useState(''), [cities, setCities] = useState<SceneCity[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function resetSearch() {
    request.current?.abort(); request.current = null;
    setCities([]); setError(''); setBusy(false);
  }
  async function search() {
    resetSearch();
    const controller = new AbortController(); request.current = controller;
    setBusy(true);
    try {
      const result = await clothesRequest<{ cities: unknown[] }>('GET', { view: 'cities', q: query.trim() }, controller.signal);
      if (controller.signal.aborted) return;
      const found = result.cities.map(readSceneCity).filter((city): city is SceneCity => city !== null);
      setCities(found); if (!found.length) setError('未找到城市');
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '城市查询失败');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <div style={{ border: '1px solid #f1f3f4', borderRadius: 10, padding: '9px 10px', marginBottom: 12 }}>
    {fields.map(({ key, label }, index) => <div key={key} style={{ marginTop: index ? 8 : 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{label}</span>
        <button type="button" aria-label={`${label}：${value[key]?.name ?? '未设置'}`} aria-expanded={editing === key}
          style={{ ...buttonStyle, overflowWrap: 'anywhere', textAlign: 'right' }}
          onClick={() => { resetSearch(); setQuery(''); setEditing(editing === key ? null : key); }}>
          {value[key]?.name ?? '未设置'}
        </button>
      </div>
      {editing === key && <div style={{ marginTop: 8 }}>
        <form style={{ display: 'flex', gap: 6 }} onSubmit={event => { event.preventDefault(); void search(); }}>
          <input aria-label={`${label}名称`} placeholder="城市名" autoFocus value={query} required minLength={2} maxLength={120}
            style={{ minWidth: 0, width: '100%', border: '1px solid #dadce0', borderRadius: 8, padding: '7px 8px', fontSize: 13 }}
            onChange={event => { resetSearch(); setQuery(event.target.value); }} />
          <button type="submit" disabled={busy || query.trim().length < 2} style={{ ...buttonStyle, flexShrink: 0 }}>
            {busy ? '查询中…' : '搜索'}
          </button>
        </form>
        {error && <div role="status" style={{ marginTop: 8, fontSize: 12, color: '#ea4335' }}>{error}</div>}
        <div style={{ display: 'grid', gap: 6, marginTop: cities.length ? 8 : 0 }}>
          {cities.map(city => <button type="button" key={`${city.name}:${city.latitude}:${city.longitude}`}
            style={{ ...buttonStyle, textAlign: 'left' }} onClick={() => {
              onChange({ ...value, [key]: city }); resetSearch(); setEditing(null);
            }}>{city.name}</button>)}
        </div>
        {value[key] && <button type="button" style={{ ...buttonStyle, marginTop: 8, color: '#5f6368' }}
          onClick={() => { onChange({ ...value, [key]: null }); resetSearch(); setEditing(null); }}>清除</button>}
      </div>}
    </div>)}
  </div>;
}
