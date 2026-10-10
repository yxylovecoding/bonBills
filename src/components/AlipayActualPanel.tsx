import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { AlipayActualFund, AlipayActualOrder, AlipayActualSnapshot, FundConfirmationRule, InvestPositionItem, InvestPositionItems } from '../models/types';
import { useConfigStore } from '../stores/configStore';
import { alipayActualBasis, groupAlipayActual, parseAlipayActual, summarizeAlipayActual } from '../utils/alipayActual';
import { fundConfirmationKey } from '../utils/alipayHoldings';
import AlipayAmountProfit from './AlipayAmountProfit';
import { useAlipayActualNavs } from '../hooks/useAlipayActualNavs';
import type { AlipayActualNav } from '../utils/alipayActualNav';

const money = (value: number) => `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusLabel = { pending: '交易进行中', confirmed: '已确认', cancelled: '已撤销', unknown: '状态待核对' };
type Estimate = { asOf: string; items: InvestPositionItems; reviewItemIds: Set<string>; renderOrders: (item: InvestPositionItem) => ReactNode };

function ActualFundDetails({ fund, orders, rule, estimate, date, nav, navLoading, onChange }: { fund: AlipayActualFund; orders: AlipayActualOrder[]; rule?: FundConfirmationRule; estimate?: Estimate; date: string; nav?: AlipayActualNav; navLoading: boolean; onChange: (fund: AlipayActualFund) => void }) {
  const basis = alipayActualBasis(fund, estimate?.items ?? {}, orders, nav);
  const unavailable = basis.issue === 'nav' ? (navLoading ? '查询净值中' : '净值暂缺') : '待核对';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ shares: '', costPrice: '', nav: '', navDate: '' });
  const [error, setError] = useState('');
  return <div className="alipay-actual-fund">
    <div className="alipay-actual-fund-header">
      <span className="alipay-actual-fund-name">{fund.name}{typeof rule === 'number' && <small> · T+{rule}</small>}</span>
      <AlipayAmountProfit amount={fund.totalAmount} holdingProfit={fund.holdingProfit} />
    </div>
    <div className="alipay-position-basis">
      <span><span className="alipay-metric-label">份额{basis.sharesEstimated ? '（推算）' : ''}</span><b>{basis.shares?.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) ?? unavailable}</b></span>
      <span><span className="alipay-metric-label">成本价{basis.costPriceEstimated ? '（推算）' : ''}</span><b>{basis.costPrice?.toFixed(4) ?? unavailable}</b></span>
      <span><span className="alipay-metric-label">成本合计（推算）</span><b>{basis.costTotal === null ? '待核对' : money(basis.costTotal)}</b></span>
    </div>
    {basis.needsReview ? (basis.issue !== 'nav' && <div className="alipay-pending">金额／交易待核对</div>) : basis.bookMismatch && <div className="alipay-pending">与一木账本不一致</div>}
    <details className="alipay-orders alipay-item-detail">
      <summary>交易与确认</summary>
      <div>{fund.code}</div>
      {basis.nav !== null && <div className="alipay-detail-line"><span>{basis.navEstimated ? '推算净值' : '实录净值'} {basis.nav.toFixed(4)}</span><span>{basis.navDate}</span></div>}
      {basis.confirmedAmount !== null && <div className="alipay-detail-line"><span>持有金额 {money(basis.confirmedAmount)}</span><span>买入中 {money(basis.pendingBuy)}</span></div>}
      {basis.pendingSell > 0 && <div>卖出未到账 {money(basis.pendingSell)}</div>}
      <button type="button" className="alipay-text-button" onClick={() => {
        setDraft({ shares: fund.shares?.toString() ?? '', costPrice: fund.costPrice?.toString() ?? '', nav: fund.nav?.toString() ?? '', navDate: fund.navDate ?? '' });
        setError(''); setEditing(true);
      }}>校对持仓</button>
      {editing && <form className="alipay-item-detail" aria-label={`${fund.name}校对持仓`} onSubmit={(event) => {
        event.preventDefault();
        try {
          const next = parseAlipayActual(JSON.stringify({ date, orders, funds: [{ ...fund,
            shares: draft.shares.trim() ? Number(draft.shares) : undefined,
            costPrice: draft.costPrice.trim() ? Number(draft.costPrice) : undefined,
            nav: draft.nav.trim() ? Number(draft.nav) : undefined, navDate: draft.navDate || undefined,
          }] })).funds[0];
          onChange(next); setEditing(false); setError('');
        } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
      }}>
        {(['shares', 'costPrice', 'nav'] as const).map((field) => <label className="alipay-detail-line" key={field}>
          {{ shares: '实录份额', costPrice: '实录成本价', nav: '金额对应净值' }[field]}
          <input type="number" step="any" min="0" value={draft[field]} placeholder="未提供" onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} />
        </label>)}
        <label className="alipay-detail-line">净值日期<input type="date" max={date} value={draft.navDate} onChange={(event) => setDraft({ ...draft, navDate: event.target.value })} /></label>
        {error && <span role="alert">{error}</span>}
        <div className="alipay-detail-line"><button type="submit" className="alipay-text-button">保存校对</button><button type="button" className="alipay-text-button" onClick={() => setEditing(false)}>取消</button></div>
      </form>}
      <label className="alipay-detail-line">确认规则
        <select aria-label={`${fund.name}确认规则`} value={rule ?? 'auto'} onChange={(event) => {
          const { config, setConfig } = useConfigStore.getState();
          const value: FundConfirmationRule = event.target.value === 'auto' ? 'auto' : event.target.value === '1' ? 1 : 2;
          setConfig({ fundConfirmationRules: { ...config.fundConfirmationRules, [fundConfirmationKey(fund.code)]: value } });
        }}><option value="auto">自动</option><option value="1">T+1</option><option value="2">T+2</option></select>
      </label>
      {orders.map((order) => <div className="alipay-order" key={order.id}>
        <div className="alipay-detail-line"><span>{order.side === 'buy' ? '买入' : '卖出'} {order.unit === 'CNY' ? money(order.quantity) : `${order.quantity} 份`}</span><span>{statusLabel[order.status]}</span></div>
        <div>{order.operationAt.replace('T', ' ')}</div>
        {(order.navDate || order.expectedConfirmationDate || order.confirmationDate) && <div className="alipay-detail-line">
          {order.navDate && <span>成交净值日 {order.navDate}</span>}
          <span>{order.confirmationDate ? `确认 ${order.confirmationDate}` : order.expectedConfirmationDate ? `预计确认 ${order.expectedConfirmationDate}` : ''}</span>
        </div>}
        {(order.confirmedShares !== undefined || order.nav !== undefined || order.fee !== undefined) && <div className="alipay-detail-line">
          {order.confirmedShares !== undefined && <span>确认 {order.confirmedShares} 份</span>}
          {order.nav !== undefined && <span>净值 {order.nav.toFixed(4)}</span>}
          {order.fee !== undefined && <span>手续费 {money(order.fee)}</span>}
        </div>}
      </div>)}
      {basis.item && estimate?.renderOrders(basis.item)}
    </details>
  </div>;
}

function SnapshotDetails({ snapshot, items, estimate, onFundChange }: { snapshot: AlipayActualSnapshot; items: InvestPositionItems; estimate?: Estimate; onFundChange: (fund: AlipayActualFund) => void }) {
  const rules = useConfigStore((state) => state.config.fundConfirmationRules);
  const navs = useAlipayActualNavs(snapshot);
  const totals = summarizeAlipayActual(snapshot);
  const sections = useMemo(() => groupAlipayActual(snapshot, items), [snapshot, items]);
  return <>
    <b>已录入 {snapshot.funds.length} 只基金</b>
    <div className="alipay-overview"><AlipayAmountProfit amount={totals.totalAmount} holdingProfit={totals.holdingProfit} /></div>
    <div className="alipay-detail-line"><span>已记录买入中 {money(totals.pendingBuy)}</span><span>卖出未到账 {money(totals.pendingSell)}</span></div>
    {totals.unknownCount > 0 && <div className="alipay-pending">状态待核对 {totals.unknownCount} 笔</div>}
    {navs.failed && !navs.loading && <button type="button" className="alipay-text-button" onClick={navs.retry}>重试净值查询</button>}
    {sections.map((section) => <section className="invest-holdings-group" key={section.label} aria-label={`支付宝实录${section.label}类`}>
      <div className="invest-holdings-group-header alipay-actual-section-header">
        <h3>{section.label}</h3>
        <AlipayAmountProfit amount={section.totals.totalAmount} holdingProfit={section.totals.holdingProfit} />
      </div>
      {section.groups.map((group) => <details className="alipay-holdings-group alipay-actual-group" key={`${snapshot.date}:${group.key}`}>
        <summary>
          <span className="alipay-actual-group-label">{group.label}</span>
          <AlipayAmountProfit amount={group.totals.totalAmount} holdingProfit={group.totals.holdingProfit} />
        </summary>
        {group.funds.map((fund) => <ActualFundDetails key={fund.code} fund={fund} rule={rules?.[fundConfirmationKey(fund.code)]} orders={snapshot.orders.filter((order) => order.code === fund.code)} estimate={estimate?.asOf === snapshot.date ? estimate : undefined} date={snapshot.date} nav={navs.results[fund.code]?.quote} navLoading={fund.shares === undefined && fund.nav === undefined && !navs.results[fund.code]} onChange={onFundChange} />)}
      </details>)}
    </section>)}
  </>;
}

export default function AlipayActualPanel({ yearMonth, items, estimate, fallback }: { yearMonth: string; items: InvestPositionItems; estimate?: Estimate; fallback: ReactNode }) {
  const snapshots = useConfigStore((state) => state.config.alipayActualSnapshots);
  const dates = Object.keys(snapshots ?? {}).filter((date) => date.startsWith(`${yearMonth}-`)).sort().reverse();
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<AlipayActualSnapshot | null>(null);
  const [message, setMessage] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const date = dates.includes(selected) ? selected : dates[0];
  const snapshot = date ? snapshots?.[date] : undefined;

  return <div className="alipay-actual">
    <div className="alipay-actual-content">
      <div className="alipay-detail-line">
        <b>{snapshot ? '支付宝实录' : '支付宝持仓'}</b>
        {dates.length > 0 && <select aria-label="支付宝实录日期" value={date} onChange={(event) => setSelected(event.target.value)}>{dates.map((value) => <option key={value}>{value}</option>)}</select>}
        <button type="button" className="alipay-text-button" onClick={() => input.current?.click()}>导入实录</button>
        <input ref={input} type="file" accept=".json,application/json" hidden aria-label="支付宝实录文件" onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          setPreview(null); setMessage('');
          try {
            if (file.size > 1_000_000) throw new Error('实录文件过大');
            const next = parseAlipayActual(await file.text());
            if (!next.date.startsWith(`${yearMonth}-`)) throw new Error(`请先切换到 ${next.date.slice(0, 7)}`);
            setPreview(next);
          } catch (error) { setMessage(error instanceof Error ? error.message : '读取实录失败'); }
        }} />
      </div>
      {message && <div role="status">{message}</div>}
      {preview ? <div className="alipay-actual-preview">
        <b>待保存 · {preview.date}{snapshots?.[preview.date] ? ' · 替换当日实录' : ''}</b>
        <SnapshotDetails snapshot={preview} items={items} estimate={estimate} onFundChange={(fund) => setPreview({ ...preview, funds: preview.funds.map((row) => row.code === fund.code ? fund : row) })} />
        <div className="alipay-detail-line">
          <button type="button" className="alipay-text-button" onClick={() => {
            const { config, setConfig } = useConfigStore.getState();
            setConfig({ alipayActualSnapshots: { ...config.alipayActualSnapshots, [preview.date]: preview } });
            setSelected(preview.date); setPreview(null); setMessage('实录已保存');
          }}>保存实录</button>
          <button type="button" className="alipay-text-button" onClick={() => setPreview(null)}>取消</button>
        </div>
      </div> : snapshot ? <SnapshotDetails snapshot={snapshot} items={items} estimate={estimate} onFundChange={(fund) => {
        const { config, setConfig } = useConfigStore.getState();
        const latest = config.alipayActualSnapshots?.[snapshot.date];
        if (!latest) throw new Error('实录已变化，请刷新后校对');
        setConfig({ alipayActualSnapshots: { ...config.alipayActualSnapshots, [snapshot.date]: { ...latest, funds: latest.funds.map((row) => row.code === fund.code ? { ...row, shares: fund.shares, costPrice: fund.costPrice, nav: fund.nav, navDate: fund.navDate, pendingOrdersComplete: fund.pendingOrdersComplete } : row) } } });
        setMessage('校对已保存');
      }} /> : fallback}
    </div>
  </div>;
}
