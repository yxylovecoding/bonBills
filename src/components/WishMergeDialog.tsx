import { useEffect, useMemo, useRef, useState } from 'react';
import type { WishItem, WishMergeRecord } from '../models/types';
import type { OutlookWishEvent } from '../utils/outlookCalendar';
import type { TripSegment } from '../utils/trips';
import { wishAssociationStatus, wishBillTags, wishTripStarts } from '../utils/wishAssociations';
import { previewWishMerge, type WishMergeChoices } from '../utils/wishMerge';

export default function WishMergeDialog({ wishes, resolved, trips, events, tripTags, history, onMerge, onUndo, onClose }: {
  wishes: WishItem[]; resolved: WishItem[]; trips: TripSegment[]; events: OutlookWishEvent[]; tripTags: Record<string, string>;
  history: WishMergeRecord[]; onMerge: (sources: WishItem[], result: WishItem) => void;
  onUndo: (record: WishMergeRecord) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [onlyIncomplete, setOnlyIncomplete] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [sources, setSources] = useState<WishItem[] | null>(null);
  const [choices, setChoices] = useState<WishMergeChoices>({ primary: '', target: '', saved: '', deadline: '', details: '' });
  const [preview, setPreview] = useState<WishItem | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);
  const billTags = useMemo(() => Object.fromEntries(resolved.map((wish) => [wish.id, wish.billSpending?.tags ?? []])), [resolved]);
  const rows = wishes.map((wish) => ({ wish, status: wishAssociationStatus(wish, trips, events, tripTags, billTags[wish.id]) }));
  const action = (work: () => void) => { setError(''); try { work(); } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); } };
  const controlStyle = { border: '1px solid #ddd6fe', borderRadius: 8, padding: '7px 10px', background: '#fff', color: '#7c3aed', cursor: 'pointer' };
  const start = () => {
    const picked = wishes.filter((wish) => selected.includes(wish.id));
    if (picked.length < 2) throw new Error('请选择至少两个心愿');
    setSources(structuredClone(picked)); setPreview(null);
    const same = (key: keyof WishItem) => picked.every((wish) => JSON.stringify(wish[key] ?? null) === JSON.stringify(picked[0][key] ?? null)) ? picked[0].id : '';
    setChoices({ primary: '', target: same('targetAmount'), saved: same('savedAmount'), deadline: same('deadline'), details: '' });
  };
  const labels = { primary: '保留名称及主心愿', target: '目标金额', saved: '已经攒下', deadline: '截止日期', details: '其他预算与启用状态' };
  const valueLabel = (wish: WishItem, field: keyof WishMergeChoices) => field === 'target' ? `¥${wish.targetAmount}` : field === 'saved' ? `¥${wish.savedAmount}` : field === 'deadline' ? wish.deadline || '无截止日期' : field === 'details' ? `${wish.isActive ? '启用' : '停用'} · 天数 ${wish.plannedTravelDays ?? 0} · 旧已花 ${(wish.spentItems ?? []).reduce((sum, item) => sum + item.amount, 0)} · 机票 ${wish.travelTicketAmount ?? 0} · 住宿/天 ${wish.travelLodgingDailyAmount ?? 0}` : wish.name;
  return <dialog ref={ref} aria-label="合并心愿" onCancel={onClose} style={{ width: 'min(600px, calc(100vw - 24px))', boxSizing: 'border-box', maxHeight: '85vh', overflow: 'auto', border: '1px solid #ddd6fe', borderRadius: 14, padding: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>合并心愿</strong><button type="button" aria-label="关闭合并" onClick={onClose} style={controlStyle}>×</button></div>
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    {!sources ? <>
      <label style={{ display: 'flex', gap: 6, margin: '14px 0', fontSize: 12 }}><input type="checkbox" checked={onlyIncomplete} onChange={(e) => { const checked = e.target.checked; setOnlyIncomplete(checked); if (checked) setSelected((ids) => ids.filter((id) => rows.some((row) => row.wish.id === id && !row.status.complete))); }} />仅显示关联不完整的心愿</label>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.filter(({ status }) => !onlyIncomplete || !status.complete).map(({ wish, status }) => <label key={wish.id} style={{ border: '1px solid #e5e7eb', padding: 10, borderRadius: 10, overflowWrap: 'anywhere', fontSize: 12 }}>
          <input type="checkbox" aria-label={`选择${wish.name}`} checked={selected.includes(wish.id)} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, wish.id] : ids.filter((id) => id !== wish.id))} /> {wish.name}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>Outlook {status.outlook ? '已关联' : '未关联'} · 标签 {status.tags ? '已关联' : '未关联'} · 出行 {status.trip ? '已关联' : '未关联'}</div>
        </label>)}
        {rows.every(({ status }) => status.complete) && onlyIncomplete && <p>没有关联缺项的心愿</p>}
      </div>
      <button type="button" onClick={() => action(start)} disabled={selected.length < 2} style={{ ...controlStyle, marginTop: 12 }}>选择保留值（{selected.length}）</button>
      {history.length > 0 && <details style={{ marginTop: 18 }}><summary>合并记录</summary>{[...history].reverse().map((record) => <div key={record.id} style={{ marginTop: 10, fontSize: 12, overflowWrap: 'anywhere' }}>
        {record.sources.map((wish) => wish.name).join('、')} → {record.result.name} {record.undoneAt ? '已撤销' : <button type="button" onClick={() => action(() => onUndo(record))} style={controlStyle}>撤销合并</button>}
        <details><summary>原记录</summary>{record.sources.map((wish) => <div key={wish.id}>{wish.name} · 目标 ¥{wish.targetAmount} · 已存 ¥{wish.savedAmount} · {wish.deadline || '无日期'} · {wishTripStarts(wish).join('、') || '未关联出行'}</div>)}</details>
      </div>)}</details>}
    </> : <>
      {!preview ? <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
        {(Object.keys(labels) as (keyof WishMergeChoices)[]).map((field) => <label key={field} style={{ fontSize: 12 }}>{labels[field]}<select aria-label={labels[field]} value={choices[field]} onChange={(e) => setChoices({ ...choices, [field]: e.target.value })} style={{ ...controlStyle, width: '100%', minWidth: 0 }}>
          <option value="">请选择保留值</option>{sources.map((wish) => <option key={wish.id} value={wish.id}>{wish.name} · {valueLabel(wish, field)}</option>)}
        </select></label>)}
        <button type="button" style={controlStyle} onClick={() => action(() => setPreview(previewWishMerge(sources, choices, tripTags, billTags)))}>预览合并</button>
      </div> : <section aria-label="合并预览" style={{ fontSize: 13, lineHeight: 1.8, overflowWrap: 'anywhere' }}>
        <h3>{preview.name}</h3><div>目标 ¥{preview.targetAmount} · 已存 ¥{preview.savedAmount}</div><div>截止日期 {preview.deadline || '未设置'}</div>
        <details><summary>其他保留值</summary>
          <div>状态：{preview.isActive ? '启用' : '停用'} · 手动出游天数：{preview.plannedTravelDays ?? 0}</div>
          <div>机票/高铁 ¥{preview.travelTicketAmount ?? 0} · 住宿总额 ¥{preview.travelLodgingAmount ?? 0} · 住宿每天 ¥{preview.travelLodgingDailyAmount ?? 0}</div>
          <div>旧手填已花 ¥{(preview.spentItems ?? []).reduce((sum, item) => sum + item.amount, 0)}（采用其他预算所选心愿）</div>
          <div>生活费修正 ¥{preview.travelLifeCorrectionAmount ?? 0} · 额外消费 ¥{preview.travelExtraExpenseAmount ?? 0} · 已还 ¥{preview.repaidAmount ?? 0}</div>
          {(preview.travelExtraExpenseItems ?? []).map((item) => <div key={item.id}>{item.name} ¥{item.amount}</div>)}
        </details>
        <div>出行：{wishTripStarts(preview).join('、') || '未关联'}</div><div>标签：{wishBillTags(preview, tripTags).join('、') || '未关联'}</div>
        <div>Outlook：{preview.outlookEventKeys?.map((key) => events.find((event) => event.key === key)?.title || '原关联（当前未同步）').join('、') || '未关联'}</div>
        <p>金额和旧手填已花按所选值保留，不相加。原心愿和历史记录保留，可在合并记录中撤销。</p>
        <button type="button" style={controlStyle} onClick={() => action(() => { onMerge(sources, preview); setSources(null); setPreview(null); setSelected([]); })}>确认合并</button>
      </section>}
      <button type="button" style={{ ...controlStyle, marginTop: 12 }} onClick={() => { if (preview) setPreview(null); else setSources(null); setError(''); }}>返回</button>
      <button type="button" style={{ ...controlStyle, marginLeft: 8 }} onClick={onClose}>取消</button>
    </>}
  </dialog>;
}
