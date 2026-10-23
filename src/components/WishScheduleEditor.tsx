import { wishTripStarts, uniqueStrings } from '../utils/wishAssociations';
import type { OutlookWishEvent } from '../utils/outlookCalendar';
import { useId, useState } from 'react';
import type { WishItem } from '../models/types';
import type { TripSegment } from '../utils/trips';
import WishDialog from './WishDialog';

type Patch = Pick<WishItem, 'deadline' | 'deadlineMode' | 'billTag' | 'linkedTripStartDate' | 'plannedTravelDays' | 'linkedTripStartDates' | 'outlookEventKeys' | 'billTags'>;
export default function WishScheduleEditor({ wish, trips, tripLabels, billTags, events, onCancel, onSave }: {
  wish: WishItem; trips: TripSegment[]; tripLabels: Record<string, string>; billTags: string[];
  events: OutlookWishEvent[];
  onCancel: () => void; onSave: (patch: Patch) => void;
}) {
  const formId = useId();
  const tagsId = useId();
  const [deadline, setDeadline] = useState(wish.deadline ?? '');
  const [trip, setTrip] = useState<string[]>(wishTripStarts(wish).length ? wishTripStarts(wish) : (wish.plannedTravelDays ?? 0) > 0 ? ['__manual__'] : []);
  const [eventKeys, setEventKeys] = useState(wish.outlookEventKeys ?? []);
  const [days, setDays] = useState(wish.plannedTravelDays ?? 1);
  const [tagMode, setTagMode] = useState(wish.billTags !== undefined ? (wish.billTags.length ? 'selected' : 'none') : wish.billTag === undefined ? 'auto' : wish.billTag === null ? 'none' : 'selected');
  const [tag, setTag] = useState(wish.billTags?.join('，') ?? wish.billTag ?? '');
  const tripOptions = [
    ...wishTripStarts(wish).filter((start) => !trips.some((item) => item.startDate === start)).map((start) => ({ value: start, label: `${start}（原关联）` })),
    ...trips.map((item) => ({ value: item.startDate, label: `${tripLabels[item.startDate] || '出行'} · ${item.startDate} — ${item.endDate}` })),
  ];
  const eventOptions = [
    ...eventKeys.filter((key) => !events.some((event) => event.key === key)).map((key) => ({ value: key, label: '原关联（当前未同步）' })),
    ...events.map((event) => ({ value: event.key, label: `${event.title} · ${event.startDate}` })),
  ];
  return <WishDialog title={`${wish.name} · 时间与绑定`} onClose={onCancel} footer={<>
    <button type="button" className="wish-button" onClick={onCancel}>取消</button>
    <button type="submit" form={formId} className="wish-button wish-button--primary">保存</button>
  </>}>
    <form id={formId} className="wish-form" onSubmit={(event) => {
      event.preventDefault();
      const starts = trip.filter((value) => value !== '__manual__');
      const tags = uniqueStrings(tag.split(/[,，]/));
      onSave({ deadline: deadline || null, deadlineMode: 'manual', linkedTripStartDate: starts[0] ?? null, linkedTripStartDates: starts, plannedTravelDays: trip.includes('__manual__') ? days : 0, outlookEventKeys: eventKeys, billTag: tagMode === 'auto' ? undefined : tagMode === 'none' ? null : tags[0], billTags: tagMode === 'auto' ? undefined : tagMode === 'none' ? [] : tags });
    }}>
      <label className="wish-field"><span>截止日期</span><input className="wish-control" aria-label="心愿截止日期" type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>
      <fieldset className="wish-fieldset">
        <legend>关联出行</legend>
        <div className="wish-options">
          <label className="wish-option"><input type="checkbox" checked={trip.length === 0} onChange={(event) => { if (event.target.checked) setTrip([]); }} />不关联出行</label>
          {tripOptions.map((option) => <label key={option.value} className="wish-option">
            <input type="checkbox" checked={trip.includes(option.value)} onChange={(event) => {
              const checked = event.target.checked;
              setTrip((values) => checked ? [...values.filter((value) => value !== '__manual__'), option.value] : values.filter((value) => value !== option.value));
            }} />{option.label}
          </label>)}
          <label className="wish-option"><input type="checkbox" checked={trip.includes('__manual__')} onChange={(event) => setTrip(event.target.checked ? ['__manual__'] : [])} />手动填写出游天数</label>
        </div>
      </fieldset>
      {trip.includes('__manual__') && <label className="wish-field"><span>出游天数</span><input className="wish-control" aria-label="出游天数" type="number" min={1} max={365} required value={days} onChange={(event) => setDays(Number(event.target.value))} /></label>}
      <fieldset className="wish-fieldset">
        <legend>Outlook 日程</legend>
        {eventOptions.length > 0 ? <div className="wish-options">
          {eventOptions.map((option) => <label key={option.value} className="wish-option">
            <input type="checkbox" checked={eventKeys.includes(option.value)} onChange={(event) => {
              const checked = event.target.checked;
              setEventKeys((keys) => checked ? [...keys, option.value] : keys.filter((key) => key !== option.value));
            }} />{option.label}
          </label>)}
        </div> : <p className="wish-field-hint">暂无可关联日程</p>}
      </fieldset>
      <label className="wish-field"><span>绑定标签</span><select className="wish-control" aria-label="标签匹配方式" value={tagMode} onChange={(event) => setTagMode(event.target.value)}><option value="auto">自动匹配</option><option value="selected">指定标签</option><option value="none">不绑定标签</option></select></label>
      {tagMode === 'selected' && <label className="wish-field"><span>标签（多个用逗号分隔）</span><input className="wish-control" aria-label="绑定标签" list={tagsId} required pattern=".*\S.*" value={tag} onChange={(event) => setTag(event.target.value)} /><datalist id={tagsId}>{billTags.map((value) => <option key={value} value={value} />)}</datalist></label>}
    </form>
  </WishDialog>;
}
