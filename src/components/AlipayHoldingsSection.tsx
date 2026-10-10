import { useMemo, useState } from 'react';
import type { FundConfirmationOverride, FundConfirmationRule, InvestPositionItems, MonthlyRecord } from '../models/types';
import { useConfigStore } from '../stores/configStore';
import { useAlipayHoldings } from '../hooks/useAlipayHoldings';
import { fundConfirmationKey, isConfirmationFund, resolveFundConfirmationRule, validConfirmationDate, type AlipayOrder } from '../utils/alipayHoldings';
import { calculateInvestPositionMonthlyProfit, summarizeInvestPositionItems, type InvestMarketSnapshot } from '../utils/investPositionItems';
import { investMeta } from '../data/mockData';

const C = { sub: '#5f6368', blue: '#1a73e8', red: '#ea4335', green: '#0d9488', orange: '#e8710a' };
const color = (value: number | null) => value === null ? C.sub : value >= 0 ? C.red : C.green;
const money = (value: number, currency = 'CNY', signed = false) => `${signed && value > 0 ? '+' : ''}${new Intl.NumberFormat('zh-CN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
const controlStyle = { border: '1px solid #dadce0', borderRadius: 6, background: '#fff', padding: '4px 6px', color: C.sub, fontSize: 11, maxWidth: '100%' };
const SECTIONS = [
  { label: '股', keys: ['us', 'eu', 'asia', 'a'] as const },
  { label: '债', keys: ['longBond', 'usBond'] as const },
  { label: '商', keys: ['gold'] as const },
];

function MonthlyReturn({ profit, value }: { profit: number | null; value: number }) {
  return <div className="invest-position-group-monthly">
    <span style={{ color: color(profit) }}>本月 {profit === null ? '—' : money(profit, 'CNY', true)}</span>
    <span style={{ color: color(profit) }}>月收益率 {profit === null || value <= 0 ? '—' : `${(profit / value * 100).toFixed(2)}%`}</span>
  </div>;
}

function ConfirmationOrders({ orders, asOf, name }: { orders: AlipayOrder[]; asOf: string; name: string }) {
  const [limit, setLimit] = useState(10);
  const sorted = [...orders].sort((a, b) => b.operationAt.localeCompare(a.operationAt));
  const save = (key: string, override: FundConfirmationOverride | null) => {
    const { config, setConfig } = useConfigStore.getState();
    setConfig({ fundConfirmationOverrides: { ...config.fundConfirmationOverrides, [key]: override } });
  };
  if (!orders.length) return null;
  return <details className="alipay-orders">
    <summary>买入确认 · {orders.length} 笔</summary>
    {sorted.slice(0, limit).map((order, index) => {
      const override = order.override;
      const mode = override?.status ?? 'auto';
      const label = order.status === 'review' ? '待校正' : order.status === 'pending' ? '待确认' : override?.status === 'confirmed' ? '已校正' : '已计入 · 推算';
      return <div key={`${order.key}:${index}`} className="alipay-order">
        <div className="alipay-detail-line">
          <span>{order.operationAt.replace('T', ' ').slice(0, 16) || '时间待补'}</span>
          <b>{order.amount === undefined ? '金额待补' : money(order.amount, order.currency)}</b>
        </div>
        <div className="alipay-detail-line" style={{ color: order.status === 'confirmed' ? C.sub : C.orange }}>
          <span>{label}</span><span>{order.confirmationDate ? `${override?.status === 'confirmed' ? '确认' : '预计'} ${order.confirmationDate}` : '日期待校正'}</span>
        </div>
        {order.shares !== undefined && order.price !== undefined && <div className="alipay-detail-line">
          <span>份额 {order.shares.toFixed(4)}</span><span>成交净值 {order.price.toFixed(4)}{order.navDate ? ` · ${order.navDate}` : ''}</span>
        </div>}
        <div className="alipay-order-controls">
          <select aria-label={`${name} ${order.operationAt}确认方式`} value={mode} disabled={order.ambiguous} style={controlStyle} onChange={(event) => {
            const status = event.target.value;
            save(order.key, status === 'auto' ? null : status === 'pending' ? { status } : {
              status: 'confirmed', date: order.operationAt.slice(0, 10) > asOf ? order.operationAt.slice(0, 10) : asOf,
            });
          }}>
            <option value="auto">自动推算</option><option value="pending">保持待确认</option><option value="confirmed">指定确认日</option>
          </select>
          {override?.status === 'confirmed' && <input type="date" aria-label={`${name} ${order.operationAt}确认日期`} value={override.date}
            min={order.operationAt.slice(0, 10) || undefined} style={controlStyle} onChange={(event) => {
              if (validConfirmationDate(event.target.value) && event.target.value >= order.operationAt.slice(0, 10)) save(order.key, { status: 'confirmed', date: event.target.value });
            }} />}
        </div>
      </div>;
    })}
    {orders.length > limit && <button type="button" className="alipay-text-button" onClick={() => setLimit(limit + 20)}>显示更早记录</button>}
  </details>;
}

export default function AlipayHoldingsSection({ items, previousItems, records, yearMonth, previousMonth, markets, previousMarkets }: {
  items: InvestPositionItems; previousItems?: InvestPositionItems; records: MonthlyRecord[];
  yearMonth: string; previousMonth?: string;
  markets: Record<string, InvestMarketSnapshot | undefined>;
  previousMarkets: Record<string, InvestMarketSnapshot | undefined>;
}) {
  const view = useAlipayHoldings(items, previousItems, records, yearMonth, previousMonth);
  const rules = useConfigStore((state) => state.config.fundConfirmationRules);
  const [past, setPast] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const summary = useMemo(() => summarizeInvestPositionItems(view.items, markets), [view.items, markets]);
  const previousSummary = useMemo(() => view.previous ? summarizeInvestPositionItems(view.previous.items, previousMarkets) : undefined, [view.previous, previousMarkets]);
  const monthly = useMemo(() => calculateInvestPositionMonthlyProfit(view.items, view.previous?.items, markets, previousMarkets), [view.items, view.previous, markets, previousMarkets]);
  const profit = previousSummary ? Math.round((summary.totalProfitCny - previousSummary.totalProfitCny) * 100) / 100 : null;
  const ordersByItem = useMemo(() => {
    const map = new Map<string, AlipayOrder[]>();
    view.orders.forEach((order) => map.set(order.itemId, [...(map.get(order.itemId) ?? []), order]));
    return map;
  }, [view.orders]);
  const pendingCount = view.orders.filter((order) => order.status === 'pending').length;
  const reviewCount = new Set([...view.reviewItemIds, ...(view.previous?.reviewItemIds ?? [])]).size;
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const sections = past ? [{ label: '', keys: ['account' as const] }, ...SECTIONS, { label: '', keys: ['aggregate' as const] }] : SECTIONS;

  return <div className="alipay-holdings">
    <div className="alipay-detail-line" style={{ color: C.sub, fontSize: 10 }}>
      <span>推算 · {view.asOf}</span><span>{[pendingCount > 0 && `待确认 ${pendingCount} 笔`, reviewCount > 0 && `待校正 ${reviewCount} 项`].filter(Boolean).join(' · ')}</span>
    </div>
    <div className="invest-holdings-totals">
      <div style={{ backgroundColor: '#f1f3f4' }}><div style={{ fontSize: 10, color: C.sub }}>持有市值</div><div className="invest-holdings-total-amount">{money(summary.totalMarketValueCny)}</div></div>
      <div style={{ backgroundColor: profit === null ? '#f1f3f4' : profit >= 0 ? '#fce8e6' : '#e6f4ea' }}>
        <div style={{ fontSize: 10, color: C.sub }}>本月收益</div><div className="invest-holdings-total-value-row" style={{ color: color(profit) }}>
          <span className="invest-holdings-total-amount">{profit === null ? '—' : money(profit, 'CNY', true)}</span>
          <span className="invest-holdings-total-rate">{profit === null || summary.totalMarketValueCny <= 0 ? '—' : `${(profit / summary.totalMarketValueCny * 100).toFixed(2)}%`}</span>
        </div>
      </div>
      <div style={{ backgroundColor: summary.totalProfitCny >= 0 ? '#fce8e6' : '#e6f4ea' }}><div style={{ fontSize: 10, color: C.sub }}>累计收益</div><div className="invest-holdings-total-amount" style={{ color: color(summary.totalProfitCny) }}>{money(summary.totalProfitCny, 'CNY', true)}</div></div>
    </div>
    <div className="holdings-view-toggle">
      {[false, true].map((isPast) => <button type="button" key={String(isPast)} aria-pressed={past === isPast} onClick={() => setPast(isPast)}>{isPast ? '历史' : '持有'}</button>)}
    </div>
    {sections.map(({ label, keys }) => {
      const categoryKeys = keys.filter((key) => key !== 'account' && key !== 'aggregate');
      const profits = categoryKeys.map((key) => monthly.byCategory[key]).filter((value): value is number => value !== null && value !== undefined);
      return <section key={label || keys[0]} className="invest-holdings-group" aria-label={label ? `${label}类持仓` : undefined}>
        {label && <div className="invest-holdings-group-header"><h3>{label}</h3><MonthlyReturn profit={profits.length ? profits.reduce((a, b) => a + b, 0) : null} value={categoryKeys.reduce((sum, key) => sum + summary.marketValueByCategory[key], 0)} /></div>}
        {keys.map((key) => {
          const groupItems = (view.items[key] ?? []).filter((item) => {
            const waiting = (ordersByItem.get(item.id) ?? []).some((order) => order.status !== 'confirmed');
            return past ? item.status !== 'active' && !waiting : item.status === 'active' || waiting;
          });
          const groupLabel = key === 'account' ? '历史账户' : key === 'aggregate' ? '待归类账户' : investMeta[key].label;
          const groupId = `${past}:${key}`;
          const value = groupItems.reduce((sum, item) => sum + (summary.metricsById[item.id]?.marketValueCny ?? 0), 0);
          return <div className="alipay-holdings-group" key={key}>
            <button type="button" className="invest-position-group-toggle alipay-group-button" aria-expanded={expanded.has(groupId)} aria-label={`${expanded.has(groupId) ? '收起' : '展开'}${groupLabel}`} onClick={() => toggle(groupId)}>
              <div className="invest-position-group-heading">
                <span className="invest-position-group-title">{expanded.has(groupId) ? '▾' : '▸'} {groupLabel}</span>
                <span className="invest-position-group-market">{money(value)}</span>
                {key !== 'account' && key !== 'aggregate' && <MonthlyReturn profit={monthly.byCategory[key] ?? null} value={summary.marketValueByCategory[key]} />}
              </div>
            </button>
            {expanded.has(groupId) && groupItems.map((item) => {
              const metric = summary.metricsById[item.id];
              const itemOrders = ordersByItem.get(item.id) ?? [];
              const currency = metric?.currency ?? item.quoteCurrency ?? 'CNY';
              const fx = metric?.fxRateToCny ?? metric?.profitFxRateToCny ?? 1;
              const monthlyProfit = monthly.byItemId[item.id];
              const fundKey = fundConfirmationKey(item.symbol);
              const rule = resolveFundConfirmationRule(view.metadata[fundKey]);
              return <div key={item.id} className="alipay-holding-item">
                <button type="button" className="alipay-item-button" aria-expanded={expanded.has(item.id)} onClick={() => toggle(item.id)}>
                  <span>{item.name} {view.reviewItemIds.has(item.id) && <small style={{ color: C.orange }}>待校正</small>}</span><span>{money((metric?.marketValueCny ?? 0) / fx, currency)}</span>
                </button>
                <div className="invest-position-summary" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', background: '#f8f9fa', color: C.sub }}>
                  <span>累计收益<br /><b style={{ color: color(metric?.totalProfitCny ?? null) }}>{money((metric?.totalProfitCny ?? 0) / (metric?.profitFxRateToCny ?? 1), metric?.profitCurrency ?? currency, true)}</b></span>
                  <span>本月收益<br /><b style={{ color: color(monthlyProfit?.value ?? null) }}>{monthlyProfit ? money(monthlyProfit.value, monthlyProfit.currency, true) : '—'}</b></span>
                </div>
                {itemOrders.filter((order) => order.status === 'pending').map((order, i) => <div className="alipay-pending" key={`${order.key}:${i}`}>
                  <span>待确认 {order.amount === undefined ? '金额待补' : money(order.amount, order.currency)}</span><span>{order.confirmationDate ? `预计 ${order.confirmationDate}` : '手动待确认'}</span>
                </div>)}
                {expanded.has(item.id) && <div className="alipay-item-detail">
                  <div className="alipay-detail-line"><span>{item.symbol}</span><span>份额 {item.shares?.toFixed(4) ?? '—'}</span></div>
                  <div className="alipay-detail-line"><span>{isConfirmationFund(item) ? '净值' : '现价'} {metric?.price?.toFixed(isConfirmationFund(item) ? 4 : 2) ?? '—'}</span><span>{metric?.quoteAt?.slice(0, 10)}</span></div>
                  <div className="alipay-detail-line"><span>成本价 {item.costPrice?.toFixed(4) ?? '—'}</span><span>持有收益 {money((metric?.holdingProfitCny ?? 0) / (metric?.profitFxRateToCny ?? 1), metric?.profitCurrency ?? currency, true)}</span></div>
                  {isConfirmationFund(item) && <label className="alipay-detail-line">确认规则
                    <select aria-label={`${item.name}确认规则`} style={controlStyle} value={rules?.[fundKey] ?? 'auto'} onChange={(event) => {
                      const { config, setConfig } = useConfigStore.getState();
                      const selected: FundConfirmationRule = event.target.value === 'auto' ? 'auto' : event.target.value === '1' ? 1 : 2;
                      setConfig({ fundConfirmationRules: { ...config.fundConfirmationRules, [fundKey]: selected } });
                    }}><option value="auto">自动{rule ? ` · T+${rule}` : ' · 待识别'}</option><option value="1">T+1</option><option value="2">T+2</option></select>
                  </label>}
                  <ConfirmationOrders orders={itemOrders} asOf={view.asOf} name={item.name} />
                </div>}
              </div>;
            })}
          </div>;
        })}
      </section>;
    })}
  </div>;
}
