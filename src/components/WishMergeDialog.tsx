import { useMemo, useState } from 'react';
import type { WishItem, WishMergeRecord } from '../models/types';
import type { OutlookWishEvent } from '../utils/outlookCalendar';
import type { TripSegment } from '../utils/trips';
import { wishAssociationStatus, wishBillTags, wishTripStarts } from '../utils/wishAssociations';
import { isWishExpiredForMerge, previewWishMerge, type WishMergeChoices } from '../utils/wishMerge';
import { formatCurrency } from './CurrencyDisplay';
import WishDialog from './WishDialog';

const labels = { primary: '保留名称及主心愿', target: '目标金额', saved: '已经攒下', deadline: '截止日期', details: '其他预算与启用状态' };
const money = (amount = 0) => `¥${formatCurrency(amount)}`;
const valueLabel = (wish: WishItem, field: keyof WishMergeChoices) => field === 'target' ? money(wish.targetAmount)
  : field === 'saved' ? money(wish.savedAmount)
    : field === 'deadline' ? wish.deadline || '无截止日期'
      : field === 'details' ? `${wish.isActive ? '启用' : '停用'} · ${wish.plannedTravelDays ?? 0} 天 · 机票 ${money(wish.travelTicketAmount)} · 住宿/天 ${money(wish.travelLodgingDailyAmount)}`
        : wish.name;

export default function WishMergeDialog({ wishes, resolved, trips, events, tripTags, history, today, onMerge, onUndo, onClose }: {
  wishes: WishItem[]; resolved: WishItem[]; trips: TripSegment[]; events: OutlookWishEvent[]; tripTags: Record<string, string>;
  history: WishMergeRecord[]; today: string; onMerge: (sources: WishItem[], result: WishItem) => void;
  onUndo: (record: WishMergeRecord) => void; onClose: () => void;
}) {
  const [onlyIncomplete, setOnlyIncomplete] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [sources, setSources] = useState<WishItem[] | null>(null);
  const [choices, setChoices] = useState<WishMergeChoices>({ primary: '', target: '', saved: '', deadline: '', details: '' });
  const [preview, setPreview] = useState<WishItem | null>(null);
  const [error, setError] = useState('');
  const billTags = useMemo(() => Object.fromEntries(resolved.map((wish) => [wish.id, wish.billSpending?.tags ?? []])), [resolved]);
  const rows = wishes.filter((wish) => !isWishExpiredForMerge(wish, trips, today))
    .map((wish) => ({ wish, status: wishAssociationStatus(wish, trips, events, tripTags, billTags[wish.id]) }));
  const visibleRows = rows.filter(({ status }) => !onlyIncomplete || !status.complete);
  const picked = visibleRows.filter(({ wish }) => selected.includes(wish.id)).map(({ wish }) => wish);
  const action = (work: () => void) => {
    setError('');
    try { work(); } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
  };
  const start = () => {
    if (picked.length < 2) throw new Error('请选择至少两个心愿');
    setSources(structuredClone(picked));
    setPreview(null);
    const same = (key: keyof WishItem) => picked.every((wish) => JSON.stringify(wish[key] ?? null) === JSON.stringify(picked[0][key] ?? null)) ? picked[0].id : '';
    setChoices({ primary: '', target: same('targetAmount'), saved: same('savedAmount'), deadline: same('deadline'), details: '' });
  };
  const validateSources = () => {
    if (sources?.some((source) => !rows.some(({ wish }) => wish.id === source.id))) {
      throw new Error('所选心愿已过期或已移除，请重新选择');
    }
  };
  const allChoicesSelected = Object.values(choices).every(Boolean);
  const footer = <>
    <button type="button" className="wish-button" onClick={onClose}>取消</button>
    {sources && <button type="button" className="wish-button" onClick={() => {
      if (preview) setPreview(null); else setSources(null);
      setError('');
    }}>返回</button>}
    {!sources ? <button type="button" className="wish-button wish-button--primary" disabled={picked.length < 2} onClick={() => action(start)}>选择保留值（{picked.length}）</button>
      : !preview ? <button type="button" className="wish-button wish-button--primary" disabled={!allChoicesSelected} onClick={() => action(() => {
        validateSources();
        setPreview(previewWishMerge(sources, choices, tripTags, billTags));
      })}>预览合并</button>
        : <button type="button" className="wish-button wish-button--primary" onClick={() => action(() => {
          validateSources();
          onMerge(sources, preview);
          setSources(null); setPreview(null); setSelected([]);
        })}>确认合并</button>}
  </>;

  return <WishDialog title="合并心愿" onClose={onClose} footer={footer}>
    {error && <p role="alert" className="wish-form-error">{error}</p>}
    {!sources ? <>
      <label className="wish-filter-option">
        <input type="checkbox" checked={onlyIncomplete} onChange={(event) => {
          const checked = event.target.checked;
          setOnlyIncomplete(checked);
          if (checked) setSelected((ids) => ids.filter((id) => rows.some((row) => row.wish.id === id && !row.status.complete)));
        }} />仅显示关联不完整的心愿
      </label>
      <div className="wish-choice-list">
        {visibleRows.map(({ wish, status }) => <label key={wish.id} className="wish-choice" data-selected={selected.includes(wish.id)}>
          <input type="checkbox" aria-label={`选择${wish.name}`} checked={selected.includes(wish.id)} onChange={(event) => {
            const checked = event.target.checked;
            setSelected((ids) => checked ? [...ids, wish.id] : ids.filter((id) => id !== wish.id));
          }} />
          <span className="wish-choice-content">
            <strong>{wish.name}</strong>
            <span className="wish-choice-meta">{wish.deadline || '无截止日期'} · {money(wish.targetAmount)}</span>
            <span className="wish-association-status">
              <span data-linked={status.outlook}>Outlook {status.outlook ? '已关联' : '未关联'}</span>
              <span data-linked={status.tags}>标签 {status.tags ? '已关联' : '未关联'}</span>
              <span data-linked={status.trip}>出行 {status.trip ? '已关联' : '未关联'}</span>
            </span>
          </span>
        </label>)}
        {visibleRows.length === 0 && <p role="status" className="wish-empty-state">{rows.length === 0 ? '暂无可合并的心愿' : '没有关联缺项的心愿'}</p>}
      </div>
      {history.length > 0 && <details className="wish-disclosure">
        <summary>合并记录 <span>{history.length}</span></summary>
        {[...history].reverse().map((record) => <div key={record.id} className="wish-merge-history">
          <div className="wish-merge-history-heading">
            <strong>{record.result.name}</strong>
            {record.undoneAt ? <span className="wish-field-hint">已撤销</span> : <button type="button" className="wish-text-button" onClick={() => action(() => onUndo(record))}>撤销合并</button>}
          </div>
          <div className="wish-field-hint">{record.sources.map((wish) => wish.name).join('、')}</div>
          <details className="wish-disclosure wish-disclosure--nested"><summary>原记录</summary>
            {record.sources.map((wish) => <div key={wish.id} className="wish-history-source">{wish.name} · 目标 {money(wish.targetAmount)} · 已存 {money(wish.savedAmount)} · {wish.deadline || '无日期'} · {wishTripStarts(wish).join('、') || '未关联出行'}</div>)}
          </details>
        </div>)}
      </details>}
    </> : !preview ? <div className="wish-form">
      {(Object.keys(labels) as (keyof WishMergeChoices)[]).map((field) => <label key={field} className="wish-field">
        <span>{labels[field]}</span>
        <select className="wish-control" aria-label={labels[field]} value={choices[field]} onChange={(event) => setChoices({ ...choices, [field]: event.target.value })}>
          <option value="">请选择保留值</option>
          {sources.map((wish) => <option key={wish.id} value={wish.id}>{field === 'primary' ? wish.name : `${wish.name} · ${valueLabel(wish, field)}`}</option>)}
        </select>
      </label>)}
    </div> : <section aria-label="合并预览" className="wish-merge-preview">
      <h3>{preview.name}</h3>
      <dl className="wish-preview-values">
        <div><dt>目标金额</dt><dd>{money(preview.targetAmount)}</dd></div>
        <div><dt>已经攒下</dt><dd>{money(preview.savedAmount)}</dd></div>
        <div><dt>截止日期</dt><dd>{preview.deadline || '未设置'}</dd></div>
        <div><dt>出行</dt><dd>{wishTripStarts(preview).join('、') || '未关联'}</dd></div>
        <div><dt>标签</dt><dd>{wishBillTags(preview, tripTags).join('、') || '未关联'}</dd></div>
        <div><dt>Outlook</dt><dd>{preview.outlookEventKeys?.map((key) => events.find((event) => event.key === key)?.title || '原关联（当前未同步）').join('、') || '未关联'}</dd></div>
      </dl>
      <details className="wish-disclosure"><summary>其他保留值</summary>
        <div className="wish-preview-details">
          <div>{preview.isActive ? '启用' : '停用'} · 手动出游 {preview.plannedTravelDays ?? 0} 天</div>
          <div>机票/高铁 {money(preview.travelTicketAmount)}</div>
          <div>住宿总额 {money(preview.travelLodgingAmount)} · 每天 {money(preview.travelLodgingDailyAmount)}</div>
          <div>手填已花 {money((preview.spentItems ?? []).reduce((sum, item) => sum + item.amount, 0))}</div>
          <div>生活费修正 {money(preview.travelLifeCorrectionAmount)} · 额外消费 {money(preview.travelExtraExpenseAmount)} · 已还 {money(preview.repaidAmount)}</div>
          {(preview.travelExtraExpenseItems ?? []).map((item) => <div key={item.id}>{item.name} {money(item.amount)}</div>)}
        </div>
      </details>
    </section>}
  </WishDialog>;
}
