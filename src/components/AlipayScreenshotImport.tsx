import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { AlipayActualSnapshot, InvestPositionItems } from '../models/types';
import { AlipayScreenshotValidationError, alipayFundChoices, alipayFundNeedsReview, alipayOrderNeedsReview, combineAlipayScreenshotDrafts, materializeAlipayScreenshots, parseAlipayScreenshot, suggestAlipayFundByAmount, type AlipayScreenshotDraft, type AlipayFundDraft, type AlipayOrderDraft } from '../utils/alipayScreenshotImport';
import { readAlipayScreenshots } from '../utils/alipayScreenshotOcr';
import { parseAlipayActual } from '../utils/alipayActual';
import { getAccountStorage } from '../utils/accountCache';
import AlipayImportDialog from './AlipayImportDialog';

const numeric = (value: string) => value.trim() === '' ? undefined : Number(value);
const money = (value: number) => `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const orderStatus = { unknown: '待核对状态', pending: '交易进行中', confirmed: '已确认', cancelled: '已撤销' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export default function AlipayScreenshotImport({ yearMonth, items, snapshots, onPreview }: {
  yearMonth: string; items: InvestPositionItems; snapshots: Record<string, AlipayActualSnapshot>;
  onPreview: (snapshot: AlipayActualSnapshot, baseline: string) => void;
}) {
  const choices = useMemo(() => alipayFundChoices(items, snapshots), [items, snapshots]);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => today().startsWith(yearMonth) ? today() : `${yearMonth}-01`);
  const [draft, setDraft] = useState<AlipayScreenshotDraft | null>(null);
  const [sources, setSources] = useState<{ name: string; url: string }[]>([]);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [attention, setAttention] = useState<AlipayScreenshotValidationError | null>(null);
  const attentionId = useId();
  const rowElements = useRef(new Map<string, HTMLFieldSetElement>());
  const [reviewOnly, setReviewOnly] = useState(false);
  const reviewCount = draft ? draft.funds.filter((row) => row.selected && alipayFundNeedsReview(row)).length
    + draft.orders.filter((row) => row.selected && alipayOrderNeedsReview(row)).length : 0;
  const [baseline, setBaseline] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const job = useRef(0);
  const controller = useRef<AbortController>();
  const trigger = useRef<HTMLButtonElement>(null);
  const owner = useRef(getAccountStorage());
  const close = () => { job.current++; controller.current?.abort(); setOpen(false); setProgress(''); setSources([]); setDraft(null); setAttention(null); trigger.current?.focus(); };
  useEffect(() => () => { job.current++; controller.current?.abort(); }, []);
  useEffect(() => () => { sources.forEach((source) => URL.revokeObjectURL(source.url)); }, [sources]);
  useEffect(() => {
    if (!attention) return;
    const row = rowElements.current.get(attention.rowId);
    if (!row) return;
    const field = Array.from(row.querySelectorAll<HTMLElement>('[data-field]')).find((element) => element.dataset.field === attention.field);
    const target = field ?? row;
    const editor = row.querySelector<HTMLDetailsElement>('.alipay-import-edit');
    if (editor && attention.field !== 'selected') editor.open = true;
    let parent = target.parentElement;
    while (parent && parent !== row) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [attention]);
  const fieldProps = (rowId: string, field: string) => ({
    'data-field': field,
    'aria-invalid': attention?.rowId === rowId && attention.field === field ? true : undefined,
    'aria-describedby': attention?.rowId === rowId && attention.field === field ? attentionId : undefined,
  });
  const rowProps = (rowId: string) => ({
    ref: (element: HTMLFieldSetElement | null) => { if (element) rowElements.current.set(rowId, element); else rowElements.current.delete(rowId); },
    tabIndex: -1,
    'data-attention': attention?.rowId === rowId || undefined,
  });
  const patchFund = (id: string, patch: Partial<AlipayFundDraft>) => {
    setError(''); setAttention(null);
    setDraft((value) => value && ({ ...value, funds: value.funds.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row, ...patch };
      if (next.amountMatch && (next.totalAmount !== next.amountMatch.totalAmount || next.amountKind !== next.amountMatch.amountKind)) {
        next.code = ''; next.amountMatch = undefined;
      }
      return next;
    }) }));
  };
  const patchOrder = (id: string, patch: Partial<AlipayOrderDraft>) => {
    setError(''); setAttention(null);
    setDraft((value) => value && ({ ...value, orders: value.orders.map((row) => row.id === id ? { ...row, ...patch } : row) }));
  };
  const fundInput = (row: { id: string; code: string }, change: (code: string) => void) => <div className="alipay-import-fund-choice">
    <label>匹配基金<select {...fieldProps(row.id, 'code')} aria-label={`${row.id}匹配基金`} value={choices.some((choice) => choice.code === row.code) ? row.code : ''} onChange={(event) => change(event.target.value)}>
      <option value="">请选择对应基金</option>
      {choices.map((choice) => <option key={choice.code} value={choice.code}>{choice.name} · {choice.code}</option>)}
    </select></label>
    <label>基金代码<input {...fieldProps(row.id, 'code')} aria-label={`${row.id}基金代码`} inputMode="numeric" pattern="[0-9]{6}" value={row.code} placeholder="六位代码" onChange={(event) => change(event.target.value.trim())} /></label>
  </div>;
  return <>
    <button ref={trigger} type="button" className="alipay-text-button" onClick={() => {
      const currentDate = today();
      setDate(currentDate.startsWith(`${yearMonth}-`) ? currentDate : `${yearMonth}-01`);
      setOpen(true); setError(''); setAttention(null); setReviewOnly(false);
    }}>导入截图</button>
    {open && <AlipayImportDialog title="支付宝截图导入" onClose={close} footer={<>
      {progress && <div role="status">{progress}</div>}
      {error && <div role="alert" className="alipay-pending">{error}</div>}
      {draft && <button type="button" className="alipay-import-confirm" disabled={!!progress} onClick={() => {
        try {
          if (getAccountStorage() !== owner.current) throw new Error('账号已切换，请重新导入');
          if (JSON.stringify(snapshots[date] ?? null) !== baseline) throw new Error('当日持仓已更新，请重新选择截图');
          const snapshot = materializeAlipayScreenshots(draft, date, choices, snapshots[date]);
          onPreview(snapshot, baseline); close(); setError('');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '请核对识别结果');
          setAttention(cause instanceof AlipayScreenshotValidationError ? cause : null);
          if (cause instanceof AlipayScreenshotValidationError) setReviewOnly(false);
        }
      }}>生成持仓预览</button>}
    </>}>
      <div className="alipay-detail-line"><label>持仓日期 <input aria-label="截图持仓日期" type="date" value={date} max={today()} disabled={!!progress} onChange={(event) => { setDate(event.target.value); setDraft(null); }} /></label>
        <button type="button" className="alipay-text-button" disabled={!!progress} onClick={() => input.current?.click()}>{draft ? '重新选择截图' : '选择截图'}</button></div>
      <span>交易记录 · 基金持有页 · 黄金持有页（可多选，也支持 JSON）</span>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,.json,application/json" multiple hidden aria-label="支付宝持仓截图文件" onChange={async (event) => {
        const files = Array.from(event.target.files ?? []); event.target.value = '';
        if (!files.length) return;
        controller.current?.abort(); controller.current = new AbortController();
        const token = ++job.current; const account = getAccountStorage(); owner.current = account;
        setError(''); setAttention(null); setDraft(null); setReviewOnly(false); setBaseline(JSON.stringify(snapshots[date] ?? null));
        try {
          if (!date || !date.startsWith(`${yearMonth}-`)) throw new Error(`请选 ${yearMonth} 的持仓日期`);
          if (files.some((file) => /\.json$/i.test(file.name))) {
            if (files.length !== 1 || files[0].size > 1_000_000) throw new Error('JSON 实录请单独选择，且不超过 1 MB');
            const value = parseAlipayActual(await files[0].text());
            if (!value.date.startsWith(`${yearMonth}-`)) throw new Error(`请先切换到 ${value.date.slice(0, 7)}`);
            if (token !== job.current || account !== getAccountStorage()) return;
            onPreview(value, JSON.stringify(snapshots[value.date] ?? null)); close(); return;
          }
          if (files.reduce((sum, file) => sum + file.size, 0) > 60_000_000) throw new Error('每批截图请控制在 60 MB 以内');
          setSources(files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })));
          const images = await readAlipayScreenshots(files, (message) => { if (token === job.current) setProgress(message); }, controller.current.signal);
          if (token !== job.current || account !== getAccountStorage()) return;
          setDraft(combineAlipayScreenshotDrafts(images.map((image) => parseAlipayScreenshot(image, choices, date))));
        } catch (cause) { if (token === job.current) setError(cause instanceof Error ? cause.message : '截图识别失败'); }
        finally { if (token === job.current) setProgress(''); }
      }} />
      {sources.length > 0 && <details><summary>查看原图（{sources.length}）</summary><div className="alipay-import-images">{sources.map((source, index) => <a href={source.url} target="_blank" rel="noreferrer" key={`${source.name}:${index}`}><img src={source.url} alt={source.name} loading="lazy" /></a>)}</div></details>}
      {draft && <>
        <div className="alipay-detail-line"><b>识别到 {draft.funds.length} 项持仓 · {draft.orders.length} 条交易</b>
          <label><input type="checkbox" checked={reviewOnly} onChange={(event) => setReviewOnly(event.target.checked)} />仅待核对（{reviewCount}）</label></div>
        {reviewOnly && reviewCount === 0 && <span role="status">所选记录已核对</span>}
        {draft.notes.map((note, index) => <div className="alipay-pending" key={index}>{note}</div>)}
        {draft.funds.map((row, index) => {
          const needsReview = alipayFundNeedsReview(row);
          if (reviewOnly && (!row.selected || !needsReview)) return null;
          const suggestions = suggestAlipayFundByAmount(row, choices, snapshots, date);
          const suggested = suggestions[0];
          const tied = suggested && suggestions[1]?.difference === suggested.difference;
          return <fieldset {...rowProps(row.id)} className="alipay-import-row" key={row.id}>
          <legend><label><input {...fieldProps(row.id, 'selected')} type="checkbox" checked={row.selected} onChange={(event) => patchFund(row.id, { selected: event.target.checked })} />持仓 {index + 1} · {choices.find((choice) => choice.code === row.code)?.name || row.name}</label></legend>
          {attention?.rowId === row.id && <div id={attentionId} className="alipay-import-warning">{attention.message}</div>}
          <div className="alipay-import-summary"><span>金额 {row.totalAmount === undefined ? '待核对' : money(row.totalAmount)}</span>
            <span>持有收益 {row.holdingProfit === undefined ? '待核对' : money(row.holdingProfit)}</span></div>
          {row.selected && needsReview && <span className="alipay-import-warning">{!row.code && /日经/.test(row.name) ? 'A/C 类别待确认' : '需核对代码或数值'}</span>}
          <details className="alipay-import-edit"><summary>{needsReview ? '核对字段' : '编辑字段'}</summary>
          {row.selected && suggested && <div className="alipay-import-suggestion" role="status">
            <b>{tied ? 'A/C 金额接近，请选择基金' : `推测为 ${suggested.name} · ${suggested.code}`}</b>
            <span>本次 {money(row.totalAmount!)}</span>
            {(tied ? suggestions.filter((candidate) => candidate.difference === suggested.difference) : [suggested]).map((candidate) => <div className="alipay-detail-line" key={candidate.code}>
              <span>{tied ? `${candidate.name} · ` : ''}上次 {money(candidate.previousAmount)}（{candidate.previousDate}）</span>
              <button type="button" className="alipay-text-button" onClick={() => patchFund(row.id, { code: candidate.code,
                amountMatch: { code: candidate.code, totalAmount: row.totalAmount!, amountKind: row.amountKind } })}>确认{tied ? `为 ${candidate.name}` : '此基金'}</button>
            </div>)}
          </div>}
          {row.selected && row.amountMatch && <span role="status">已确认基金匹配</span>}
          <div className="alipay-import-fields">{fundInput(row, (code) => patchFund(row.id, { code, amountMatch: undefined }))}
            <label>金额<input {...fieldProps(row.id, 'totalAmount')} aria-label={`${row.id}金额`} type="number" step="0.01" min="0" value={row.totalAmount ?? ''} onChange={(event) => patchFund(row.id, { totalAmount: numeric(event.target.value) })} /></label>
            <label>持有收益<input {...fieldProps(row.id, 'holdingProfit')} aria-label={`${row.id}持有收益`} type="number" step="0.01" value={row.holdingProfit ?? ''} onChange={(event) => patchFund(row.id, { holdingProfit: numeric(event.target.value) })} /></label>
          </div>
          <details><summary>份额、成本与净值</summary><div className="alipay-import-fields">
            {(['shares','costPrice','confirmedAmount','pendingBuyAmount','nav'] as const).map((key) => <label key={key}>{{ shares:'真实份额', costPrice:'真实成本价', confirmedAmount:'持有金额', pendingBuyAmount:'待确认金额', nav:'对应净值' }[key]}<input {...fieldProps(row.id, key)} type="number" step="any" min="0" value={row[key] ?? ''} onChange={(event) => patchFund(row.id, { [key]: numeric(event.target.value) })} /></label>)}
            <label>净值日期<input {...fieldProps(row.id, 'navDate')} type="date" max={date} value={row.navDate ?? ''} onChange={(event) => patchFund(row.id, { navDate: event.target.value || undefined })} /></label>
            <label>金额类型<select {...fieldProps(row.id, 'amountKind')} value={row.amountKind} onChange={(event) => patchFund(row.id, { amountKind: event.target.value as AlipayFundDraft['amountKind'] })}><option value="total">包含在途的总金额</option><option value="confirmed">已确认的持有金额</option></select></label>
          </div></details>
          </details>
        </fieldset>; })}
        {draft.orders.map((row, index) => {
          const needsReview = alipayOrderNeedsReview(row);
          if (reviewOnly && (!row.selected || !needsReview)) return null;
          return <fieldset {...rowProps(row.id)} className="alipay-import-row" key={row.id}>
          <legend><label><input {...fieldProps(row.id, 'selected')} type="checkbox" checked={row.selected} onChange={(event) => patchOrder(row.id, { selected: event.target.checked })} />交易 {index + 1} · {choices.find((choice) => choice.code === row.code)?.name || row.name || '基金待匹配'}</label></legend>
          {attention?.rowId === row.id && <div id={attentionId} className="alipay-import-warning">{attention.message}</div>}
          <div className="alipay-import-summary"><span>{row.operationAt ? row.operationAt.replace('T', ' ') : '时间待核对'}</span>
            <span>{row.side === 'sell' ? '卖出' : '买入'} {row.quantity === undefined ? '数量待核对' : row.unit === 'CNY' ? money(row.quantity) : `${row.quantity.toLocaleString('zh-CN')} 份`}</span>
            <span>{orderStatus[row.status]}</span></div>
          {row.notes.filter((note) => /重复|冲突|未截全/.test(note)).map((note) => <span className="alipay-import-warning" key={note}>{note}</span>)}
          {row.selected && needsReview && <span className="alipay-import-warning">需核对基金、时间、数量或状态</span>}
          <details className="alipay-import-edit"><summary>{needsReview ? '核对字段' : '编辑字段'}</summary>
          <div className="alipay-import-fields">{fundInput(row, (code) => patchOrder(row.id, { code }))}
            <label>操作时间<input {...fieldProps(row.id, 'operationAt')} aria-label={`${row.id}操作时间`} type="datetime-local" step="1" value={row.operationAt} onChange={(event) => patchOrder(row.id, { operationAt: event.target.value.length === 16 ? `${event.target.value}:00` : event.target.value })} /></label>
            <label>买卖<select {...fieldProps(row.id, 'side')} value={row.side} onChange={(event) => patchOrder(row.id, { side: event.target.value as 'buy' | 'sell' })}><option value="buy">买入</option><option value="sell">卖出</option></select></label>
            <label>金额／份额<input {...fieldProps(row.id, 'quantity')} aria-label={`${row.id}交易数量`} type="number" min="0" step="any" value={row.quantity ?? ''} onChange={(event) => patchOrder(row.id, { quantity: numeric(event.target.value) })} /></label>
            <label>单位<select {...fieldProps(row.id, 'unit')} value={row.unit} onChange={(event) => patchOrder(row.id, { unit: event.target.value as 'CNY' | 'shares' })}><option value="CNY">元</option><option value="shares">份</option></select></label>
            <label>状态<select {...fieldProps(row.id, 'status')} aria-label={`${row.id}交易状态`} value={row.status} onChange={(event) => patchOrder(row.id, { status: event.target.value as AlipayOrderDraft['status'] })}><option value="unknown">待核对</option><option value="pending">交易进行中</option><option value="confirmed">已确认</option><option value="cancelled">已撤销</option></select></label>
          </div>
          <details><summary>订单与确认信息</summary><div className="alipay-import-fields">
            <label>订单号<input {...fieldProps(row.id, 'orderId')} value={row.orderId ?? ''} onChange={(event) => patchOrder(row.id, { orderId: event.target.value.trim() || undefined })} /></label>
            {(['navDate', 'confirmationDate', 'expectedConfirmationDate'] as const).map((key) => <label key={key}>{{navDate:'成交净值日', confirmationDate:'实际确认日期', expectedConfirmationDate:'预计确认日期'}[key]}<input {...fieldProps(row.id, key)} type="date" value={row[key] ?? ''} onChange={(event) => patchOrder(row.id, { [key]: event.target.value || undefined })} /></label>)}
            {(['confirmedShares', 'nav', 'fee'] as const).map((key) => <label key={key}>{{confirmedShares:'确认份额', nav:'成交净值', fee:'手续费'}[key]}<input {...fieldProps(row.id, key)} type="number" min="0" step="any" value={row[key] ?? ''} onChange={(event) => patchOrder(row.id, { [key]: numeric(event.target.value) })} /></label>)}
          </div></details>
          </details>
        </fieldset>; })}
      </>}
    </AlipayImportDialog>}
  </>;
}
