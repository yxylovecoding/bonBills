import { useEffect, useRef, useState } from 'react';
import type { WishItem } from '../models/types';
import type { TripSegment } from '../utils/trips';

type Patch = Pick<WishItem, 'deadline' | 'deadlineMode' | 'billTag' | 'linkedTripStartDate' | 'plannedTravelDays'>;
export default function WishScheduleEditor({ wish, trips, tripLabels, billTags, onCancel, onSave }: {
  wish: WishItem; trips: TripSegment[]; tripLabels: Record<string, string>; billTags: string[];
  onCancel: () => void; onSave: (patch: Patch) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [deadline, setDeadline] = useState(wish.deadline ?? '');
  const [trip, setTrip] = useState(wish.linkedTripStartDate ?? ((wish.plannedTravelDays ?? 0) > 0 ? '__manual__' : ''));
  const [days, setDays] = useState(wish.plannedTravelDays ?? 1);
  const [tagMode, setTagMode] = useState(wish.billTag === undefined ? 'auto' : wish.billTag === null ? 'none' : 'selected');
  const [tag, setTag] = useState(wish.billTag ?? '');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const inputStyle = { width: '100%', minWidth: 0, padding: 8, border: '1px solid #ddd6fe', borderRadius: 8, background: '#fff', color: '#202124', boxSizing: 'border-box' as const };
  return <dialog ref={dialog} aria-label={`${wish.name}时间与绑定`} onCancel={onCancel} style={{ width: 'min(380px, calc(100vw - 32px))', boxSizing: 'border-box', maxHeight: '85vh', overflow: 'auto', border: '1px solid #ddd6fe', borderRadius: 14, padding: 20 }}>
    <form onSubmit={(event) => { event.preventDefault(); onSave({ deadline: deadline || null, deadlineMode: 'manual', linkedTripStartDate: trip && trip !== '__manual__' ? trip : null, plannedTravelDays: trip === '__manual__' ? days : 0, billTag: tagMode === 'auto' ? undefined : tagMode === 'none' ? null : tag.trim() }); }} style={{ display: 'grid', gap: 14, fontSize: 13 }}>
      <strong>{wish.name} · 时间与绑定</strong>
      <label>截止日期<input aria-label="心愿截止日期" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={inputStyle} /></label>
      <label>关联出行<select aria-label="关联出行" value={trip} onChange={(e) => setTrip(e.target.value)} style={inputStyle}>
        <option value="">不关联出行</option>
        {wish.linkedTripStartDate && !trips.some((item) => item.startDate === wish.linkedTripStartDate) && <option value={wish.linkedTripStartDate}>{wish.linkedTripStartDate}（原关联）</option>}
        {trips.map((item) => <option key={item.startDate} value={item.startDate}>{item.startDate} — {item.endDate} {tripLabels[item.startDate] || '出行'}</option>)}
        <option value="__manual__">未排进日历，按天数计算</option>
      </select></label>
      {trip === '__manual__' && <label>出游天数<input aria-label="出游天数" type="number" min={1} max={365} required value={days} onChange={(e) => setDays(Number(e.target.value))} style={inputStyle} /></label>}
      <label>绑定标签<select aria-label="标签匹配方式" value={tagMode} onChange={(e) => setTagMode(e.target.value)} style={inputStyle}><option value="auto">自动匹配</option><option value="selected">指定标签</option><option value="none">不绑定标签</option></select></label>
      {tagMode === 'selected' && <label>标签<input aria-label="绑定标签" list="wish-schedule-tags" required pattern=".*\S.*" value={tag} onChange={(e) => setTag(e.target.value)} style={inputStyle} /><datalist id="wish-schedule-tags">{billTags.map((value) => <option key={value} value={value} />)}</datalist></label>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}><button type="button" onClick={onCancel}>取消</button><button type="submit">保存</button></div>
    </form>
  </dialog>;
}
