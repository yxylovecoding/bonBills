import { wishTripStarts, uniqueStrings } from '../utils/wishAssociations';
import type { OutlookWishEvent } from '../utils/outlookCalendar';
import { useEffect, useRef, useState } from 'react';
import type { WishItem } from '../models/types';
import type { TripSegment } from '../utils/trips';

type Patch = Pick<WishItem, 'deadline' | 'deadlineMode' | 'billTag' | 'linkedTripStartDate' | 'plannedTravelDays' | 'linkedTripStartDates' | 'outlookEventKeys' | 'billTags'>;
export default function WishScheduleEditor({ wish, trips, tripLabels, billTags, events, onCancel, onSave }: {
  wish: WishItem; trips: TripSegment[]; tripLabels: Record<string, string>; billTags: string[];
  events: OutlookWishEvent[];
  onCancel: () => void; onSave: (patch: Patch) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [deadline, setDeadline] = useState(wish.deadline ?? '');
  const [trip, setTrip] = useState<string[]>(wishTripStarts(wish).length ? wishTripStarts(wish) : (wish.plannedTravelDays ?? 0) > 0 ? ['__manual__'] : []);
  const [eventKeys, setEventKeys] = useState(wish.outlookEventKeys ?? []);
  const [days, setDays] = useState(wish.plannedTravelDays ?? 1);
  const [tagMode, setTagMode] = useState(wish.billTags !== undefined ? (wish.billTags.length ? 'selected' : 'none') : wish.billTag === undefined ? 'auto' : wish.billTag === null ? 'none' : 'selected');
  const [tag, setTag] = useState(wish.billTags?.join('，') ?? wish.billTag ?? '');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const inputStyle = { width: '100%', minWidth: 0, padding: 8, border: '1px solid #ddd6fe', borderRadius: 8, background: '#fff', color: '#202124', boxSizing: 'border-box' as const };
  return <dialog ref={dialog} aria-label={`${wish.name}时间与绑定`} onCancel={onCancel} style={{ width: 'min(380px, calc(100vw - 32px))', boxSizing: 'border-box', maxHeight: '85vh', overflow: 'auto', border: '1px solid #ddd6fe', borderRadius: 14, padding: 20 }}>
    <form onSubmit={(event) => { event.preventDefault(); const starts = trip.filter((value) => value && value !== '__manual__'); const tags = uniqueStrings(tag.split(/[,，]/)); onSave({ deadline: deadline || null, deadlineMode: 'manual', linkedTripStartDate: starts[0] ?? null, linkedTripStartDates: starts, plannedTravelDays: trip.includes('__manual__') ? days : 0, outlookEventKeys: eventKeys, billTag: tagMode === 'auto' ? undefined : tagMode === 'none' ? null : tags[0], billTags: tagMode === 'auto' ? undefined : tagMode === 'none' ? [] : tags }); }} style={{ display: 'grid', gap: 14, fontSize: 13 }}>
      <strong>{wish.name} · 时间与绑定</strong>
      <label>截止日期<input aria-label="心愿截止日期" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} style={inputStyle} /></label>
      <label>关联出行<select aria-label="关联出行" multiple size={4} value={trip} onChange={(e) => { const values = [...e.target.selectedOptions].map((option) => option.value); setTrip(values.includes('__manual__') ? ['__manual__'] : values.filter(Boolean)); }} style={inputStyle}>
        <option value="">不关联出行</option>
        {wishTripStarts(wish).filter((start) => !trips.some((item) => item.startDate === start)).map((start) => <option key={start} value={start}>{start}（原关联）</option>)}
        {trips.map((item) => <option key={item.startDate} value={item.startDate}>{item.startDate} — {item.endDate} {tripLabels[item.startDate] || '出行'}</option>)}
        <option value="__manual__">未排进日历，按天数计算</option>
      </select></label>
      {trip.includes('__manual__') && <label>出游天数<input aria-label="出游天数" type="number" min={1} max={365} required value={days} onChange={(e) => setDays(Number(e.target.value))} style={inputStyle} /></label>}
      <label>Outlook 日程<select aria-label="Outlook 日程" multiple size={4} value={eventKeys} onChange={(e) => setEventKeys([...e.target.selectedOptions].map((option) => option.value))} style={inputStyle}>
        {eventKeys.filter((key) => !events.some((event) => event.key === key)).map((key) => <option key={key} value={key}>原关联（当前未同步）</option>)}
        {events.map((event) => <option key={event.key} value={event.key}>{event.startDate} {event.title}</option>)}
      </select></label>
      {!events.length && <span style={{ color: '#5f6368', fontSize: 11 }}>暂无可关联日程，请先同步 Outlook。</span>}
      <label>绑定标签<select aria-label="标签匹配方式" value={tagMode} onChange={(e) => setTagMode(e.target.value)} style={inputStyle}><option value="auto">自动匹配</option><option value="selected">指定标签</option><option value="none">不绑定标签</option></select></label>
      {tagMode === 'selected' && <label>标签（多个用逗号分隔）<input aria-label="绑定标签" list="wish-schedule-tags" required pattern=".*\S.*" value={tag} onChange={(e) => setTag(e.target.value)} style={inputStyle} /><datalist id="wish-schedule-tags">{billTags.map((value) => <option key={value} value={value} />)}</datalist></label>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}><button type="button" onClick={onCancel}>取消</button><button type="submit">保存</button></div>
    </form>
  </dialog>;
}
