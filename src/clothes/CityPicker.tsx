import { useEffect, useRef, useState } from 'react';
import type { ClothesLocation } from './types';
import { clothesRequest } from './client';

export default function CityPicker({ initial = '', onSelect, onClose }: { initial?: string; onSelect: (location: ClothesLocation) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), request = useRef(0);
  const [query, setQuery] = useState(initial), [cities, setCities] = useState<ClothesLocation[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); return () => { request.current++; }; }, []);
  async function search() {
    const token = ++request.current; setBusy(true); setError(''); setCities([]);
    try {
      const result = await clothesRequest<{ cities: ClothesLocation[] }>('GET', { view: 'cities', q: query });
      if (token === request.current) { setCities(result.cities); if (!result.cities.length) setError('未找到城市，请输入城市名'); }
    } catch (cause) { if (token === request.current) setError(cause instanceof Error ? cause.message : '城市查询失败'); }
    finally { if (token === request.current) setBusy(false); }
  }
  return <dialog ref={dialog} className="life-dialog clothes-dialog" aria-labelledby="city-title" onCancel={onClose}>
    <div className="life-editor-heading"><h2 id="city-title">选择城市</h2><button onClick={onClose}>关闭</button></div>
    <form className="clothes-search" onSubmit={(e) => { e.preventDefault(); void search(); }}><input aria-label="城市名" value={query} minLength={2} maxLength={120} required placeholder="城市名" onChange={(e) => { setQuery(e.target.value); request.current++; setBusy(false); setCities([]); }} /><button className="life-primary" disabled={busy}>{busy ? '查询中…' : '搜索'}</button></form>
    {error && <p role="status" className="life-error">{error}</p>}
    <div className="clothes-city-results">{cities.map((city) => <button key={`${city.latitude}:${city.longitude}`} onClick={() => onSelect(city)}>{city.name}</button>)}</div>
  </dialog>;
}
