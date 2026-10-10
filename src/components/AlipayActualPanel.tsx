import { useRef, useState } from 'react';
import type { AlipayActualSnapshot } from '../models/types';
import { useConfigStore } from '../stores/configStore';
import { alipayActualCost, parseAlipayActual, summarizeAlipayActual } from '../utils/alipayActual';
import { fundConfirmationKey } from '../utils/alipayHoldings';

const money = (value: number) => `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const statusLabel = { pending: '交易进行中', confirmed: '已确认', cancelled: '已撤销', unknown: '状态待核对' };

function SnapshotDetails({ snapshot }: { snapshot: AlipayActualSnapshot }) {
  const rules = useConfigStore((state) => state.config.fundConfirmationRules);
  const totals = summarizeAlipayActual(snapshot);
  return <>
    <div className="alipay-detail-line"><b>已录入 {snapshot.funds.length} 只基金</b><b>{money(totals.totalAmount)}</b></div>
    <div className="alipay-detail-line"><span>已记录买入中 {money(totals.pendingBuy)}</span><span>卖出未到账 {money(totals.pendingSell)}</span></div>
    {totals.unknownCount > 0 && <div className="alipay-pending">状态待核对 {totals.unknownCount} 笔</div>}
    {snapshot.funds.map((fund) => {
      const orders = snapshot.orders.filter((order) => order.code === fund.code);
      const cost = alipayActualCost(fund);
      const rule = rules?.[fundConfirmationKey(fund.code)];
      return <details key={fund.code} className="alipay-actual-fund">
        <summary><span>{fund.name}{typeof rule === 'number' && <small> · T+{rule}</small>}</span><b>{money(fund.totalAmount)}</b></summary>
        <div className="alipay-item-detail">
          <div className="alipay-detail-line"><span>{fund.code}</span><span>持有收益 {money(fund.holdingProfit)}</span></div>
          <div className="alipay-detail-line"><span>实录份额 {fund.shares?.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) ?? '待补'}</span><span>成本合计（反推）{cost === null ? '待核对' : money(cost)}</span></div>
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
        </div>
      </details>;
    })}
  </>;
}

export default function AlipayActualPanel({ yearMonth }: { yearMonth: string }) {
  const snapshots = useConfigStore((state) => state.config.alipayActualSnapshots);
  const dates = Object.keys(snapshots ?? {}).filter((date) => date.startsWith(`${yearMonth}-`)).sort().reverse();
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<AlipayActualSnapshot | null>(null);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const date = dates.includes(selected) ? selected : dates[0];
  const snapshot = date ? snapshots?.[date] : undefined;

  return <details className="alipay-actual" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>支付宝实录{snapshot ? ` · ${snapshot.date} · ${money(summarizeAlipayActual(snapshot).totalAmount)}` : ''}</summary>
    <div className="alipay-actual-content">
      <div className="alipay-detail-line">
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
        <SnapshotDetails snapshot={preview} />
        <div className="alipay-detail-line">
          <button type="button" className="alipay-text-button" onClick={() => {
            const { config, setConfig } = useConfigStore.getState();
            setConfig({ alipayActualSnapshots: { ...config.alipayActualSnapshots, [preview.date]: preview } });
            setSelected(preview.date); setPreview(null); setMessage('实录已保存');
          }}>保存实录</button>
          <button type="button" className="alipay-text-button" onClick={() => setPreview(null)}>取消</button>
        </div>
      </div> : snapshot ? <SnapshotDetails snapshot={snapshot} /> : <span>本月暂无实录</span>}
    </div>
  </details>;
}
