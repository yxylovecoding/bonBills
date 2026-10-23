import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AlipayActualFund, AlipayActualOrder, AlipayActualSnapshot, FundConfirmationRule, InvestPositionItem, InvestPositionItems } from '../models/types';
import { useConfigStore } from '../stores/configStore';
import { alipayActualBasis, groupAlipayActual, summarizeAlipayActual } from '../utils/alipayActual';
import { fundConfirmationKey } from '../utils/alipayHoldings';
import AlipayAmountProfit from './AlipayAmountProfit';
import { useAlipayActualNavs } from '../hooks/useAlipayActualNavs';
import type { AlipayActualNav } from '../utils/alipayActualNav';
import AlipayCorrectionButton from './AlipayCorrectionButton';
import AlipayScreenshotImport from './AlipayScreenshotImport';
import { investMeta } from '../data/mockData';
import { importAlipaySnapshotToLedger } from '../utils/alipayLedgerImport';

const money = (value: number) => `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusLabel = { pending: '交易进行中', confirmed: '已确认', cancelled: '已撤销', unknown: '状态待核对' };
type Estimate = { asOf: string; items: InvestPositionItems; reviewItemIds: Set<string>; renderOrders: (item: InvestPositionItem) => ReactNode };

function ActualFundDetails({ fund, orders, rule, estimate, nav, navLoading }: { fund: AlipayActualFund; orders: AlipayActualOrder[]; rule?: FundConfirmationRule; estimate?: Estimate; nav?: AlipayActualNav; navLoading: boolean }) {
  const basis = alipayActualBasis(fund, estimate?.items ?? {}, orders, nav);
  const unavailable = basis.issue === 'nav' ? (navLoading ? '查询净值中' : '净值暂缺') : '待核对';
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

function SnapshotDetails({ snapshot, items, estimate }: { snapshot: AlipayActualSnapshot; items: InvestPositionItems; estimate?: Estimate }) {
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
          <span className="invest-position-group-title alipay-actual-group-label">
            <span className="alipay-group-dot" aria-hidden="true" style={{ backgroundColor: group.key === 'unclassified' ? '#5f6368' : investMeta[group.key === 'japan' ? 'asia' : group.key].color }} />
            {group.label}
          </span>
          <AlipayAmountProfit amount={group.totals.totalAmount} holdingProfit={group.totals.holdingProfit} />
        </summary>
        {group.funds.map((fund) => <ActualFundDetails key={fund.code} fund={fund} rule={rules?.[fundConfirmationKey(fund.code)]} orders={snapshot.orders.filter((order) => order.code === fund.code)} estimate={estimate?.asOf === snapshot.date ? estimate : undefined} nav={navs.results[fund.code]?.quote} navLoading={fund.shares === undefined && fund.nav === undefined && !navs.results[fund.code]} />)}
      </details>)}
    </section>)}
  </>;
}

export default function AlipayActualPanel({ yearMonth, items, estimate, fallback }: { yearMonth: string; items: InvestPositionItems; estimate?: Estimate; fallback: ReactNode }) {
  const snapshots = useConfigStore((state) => state.config.alipayActualSnapshots);
  const dates = Object.keys(snapshots ?? {}).filter((date) => date.startsWith(`${yearMonth}-`)).sort().reverse();
  const [selected, setSelected] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { setMessage(''); }, [yearMonth]);
  const date = dates.includes(selected) ? selected : dates[0];
  const snapshot = date ? snapshots?.[date] : undefined;

  return <div className="alipay-actual">
    <div className="alipay-actual-content">
      <div className="alipay-detail-line">
        <b>支付宝持仓</b>
        <AlipayScreenshotImport key={yearMonth} yearMonth={yearMonth} items={items} snapshots={snapshots ?? {}} onImport={async (next, baseline, importedCodes) => {
          if (!next.date.startsWith(`${yearMonth}-`)) throw new Error('月份已切换，请重新导入');
          const result = await importAlipaySnapshotToLedger(next, baseline, undefined, importedCodes);
          setSelected(next.date); setMessage(result.message);
        }} />
      </div>
      {message && <div role="status">{message}</div>}
      {fallback}
      {snapshot && <details className="alipay-orders">
        <summary>导入记录</summary>
        <div className="alipay-detail-line">
          <select aria-label="支付宝导入记录日期" value={date} onChange={(event) => setSelected(event.target.value)}>{dates.map((value) => <option key={value}>{value}</option>)}</select>
          <AlipayCorrectionButton snapshot={snapshot} onSynced={setMessage} />
        </div>
        <SnapshotDetails snapshot={snapshot} items={items} estimate={estimate} />
      </details>}
    </div>
  </div>;
}
