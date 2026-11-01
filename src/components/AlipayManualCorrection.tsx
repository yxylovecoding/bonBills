import { useId, useState, type ReactNode } from 'react';
import type { AlipayActualOrder, AlipayActualSnapshot, InvestPositionGroupKey, InvestPositionItems } from '../models/types';
import type { InvestPositionDraft } from '../utils/investPositionDrafts';
import { INVEST_POSITION_GROUP_KEYS, type InvestMarketSnapshot } from '../utils/investPositionItems';
import { useConfigStore } from '../stores/configStore';
import { getAccountStorage } from '../utils/accountCache';
import { triggerUpload } from '../utils/syncEngine';
import { alipayOrderDraft, correctAlipayRecordedOrder } from '../utils/alipayManualCorrection';
import AlipayImportDialog from './AlipayImportDialog';
import { AlipayHoldingDialog } from './AlipayHoldingEditor';

function OrderDialog({ snapshot, order, children, onClose, onSaved }: {
  snapshot: AlipayActualSnapshot; order: AlipayActualOrder; children: ReactNode; onClose: () => void; onSaved: () => void;
}) {
  const formId = useId();
  const [draft, setDraft] = useState(() => alipayOrderDraft(order));
  const [baseline] = useState(() => JSON.stringify(snapshot));
  const [owner] = useState(getAccountStorage);
  const [error, setError] = useState('');
  return <AlipayImportDialog title="支付宝手动修正" onClose={onClose} footer={<>
    {error && <div role="alert" className="alipay-import-warning">{error}</div>}
    <div className="alipay-detail-line"><button type="button" className="alipay-text-button" onClick={onClose}>取消</button><button type="submit" form={formId} className="alipay-import-confirm">保存</button></div>
  </>}>
    {children}
    <form id={formId} className="alipay-import-fields" onSubmit={(event) => {
      event.preventDefault();
      try {
        if (owner !== getAccountStorage()) throw new Error('账号已切换，请重新编辑');
        const { config, setConfig } = useConfigStore.getState();
        if (baseline !== JSON.stringify(config.alipayActualSnapshots?.[snapshot.date])) throw new Error('交易已更新，请关闭后重新编辑');
        const next = correctAlipayRecordedOrder(snapshot, order.id, draft);
        setConfig({ alipayActualSnapshots: { ...config.alipayActualSnapshots, [snapshot.date]: next } });
        void triggerUpload();
        onSaved(); onClose();
      } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    }}>
      <label className="alipay-import-fund-choice">基金<select aria-label="基金" value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })}>{snapshot.funds.map((fund) => <option key={fund.code} value={fund.code}>{fund.name} · {fund.code}</option>)}</select></label>
      <label>交易方向<select aria-label="交易方向" value={draft.side} onChange={(event) => setDraft({ ...draft, side: event.target.value as typeof draft.side })}><option value="buy">买入</option><option value="sell">卖出</option></select></label>
      <label>交易状态<select aria-label="交易状态" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as typeof draft.status })}><option value="pending">{draft.side === 'sell' ? '卖出未到账' : '交易进行中'}</option><option value="confirmed">已完成</option><option value="cancelled">已撤销</option><option value="unknown">待核对</option></select></label>
      <label>交易数量<input type="number" min="0" step="any" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label>
      <label>交易单位<select aria-label="交易单位" value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value as typeof draft.unit })}><option value="shares">份</option><option value="CNY">元</option></select></label>
      <label className="alipay-import-fund-choice">交易时间<input type="datetime-local" step="1" value={draft.operationAt} onChange={(event) => setDraft({ ...draft, operationAt: event.target.value })} /></label>
      <label>预计到账日期<input type="date" value={draft.expectedArrivalDate ?? ''} onChange={(event) => setDraft({ ...draft, expectedArrivalDate: event.target.value })} /></label>
      <label>确认日期<input type="date" value={draft.confirmationDate ?? ''} onChange={(event) => setDraft({ ...draft, confirmationDate: event.target.value })} /></label>
      <details className="alipay-import-fund-choice"><summary>成交详情</summary><div className="alipay-import-fields">
        <label>确认份额<input type="number" min="0" step="any" value={draft.confirmedShares} onChange={(event) => setDraft({ ...draft, confirmedShares: event.target.value })} /></label>
        <label>成交净值<input type="number" min="0" step="any" value={draft.nav} onChange={(event) => setDraft({ ...draft, nav: event.target.value })} /></label>
        <label>净值日期<input type="date" value={draft.navDate ?? ''} onChange={(event) => setDraft({ ...draft, navDate: event.target.value })} /></label>
        <label>预计确认日期<input type="date" value={draft.expectedConfirmationDate ?? ''} onChange={(event) => setDraft({ ...draft, expectedConfirmationDate: event.target.value })} /></label>
        <label>手续费<input type="number" min="0" step="any" value={draft.fee} onChange={(event) => setDraft({ ...draft, fee: event.target.value })} /></label>
      </div></details>
    </form>
  </AlipayImportDialog>;
}

export default function AlipayManualCorrection({ items, markets, yearMonth, onUpdate, onSaved }: {
  items: InvestPositionItems; markets: Record<string, InvestMarketSnapshot | undefined>; yearMonth: string;
  onUpdate: (group: InvestPositionGroupKey, id: string, patch: Partial<InvestPositionDraft>) => void; onSaved: (message: string) => void;
}) {
  const snapshots = useConfigStore((state) => state.config.alipayActualSnapshots);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'holding' | 'order'>('holding');
  const [selection, setSelection] = useState('');
  const positions = INVEST_POSITION_GROUP_KEYS.filter((key) => key !== 'account' && key !== 'aggregate')
    .flatMap((group) => (items[group] ?? []).map((item) => ({ group, item, key: `${group}:${item.id}` })));
  const orders = Object.values(snapshots ?? {}).filter((snapshot) => snapshot.date.startsWith(`${yearMonth}-`))
    .sort((a, b) => b.date.localeCompare(a.date)).flatMap((snapshot) => snapshot.orders.map((order) => ({ snapshot, order, key: `${snapshot.date}:${order.id}` })));
  const position = positions.find((entry) => entry.key === selection) ?? positions[0];
  const selectedOrder = orders.find((entry) => entry.key === selection) ?? orders[0];
  const close = () => setOpen(false);
  const controls = <div className="alipay-import-fields">
    <label className="alipay-import-fund-choice">修正内容<select aria-label="修正内容" value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); setSelection(''); }}><option value="holding">持仓</option><option value="order">导入交易</option></select></label>
    {mode === 'holding' ? <label className="alipay-import-fund-choice">选择持仓<select aria-label="选择持仓" value={position?.key ?? ''} onChange={(event) => setSelection(event.target.value)}>{positions.map((entry) => <option key={entry.key} value={entry.key}>{entry.item.name} · {entry.item.symbol}</option>)}</select></label>
      : <label className="alipay-import-fund-choice">选择交易<select aria-label="选择交易" value={selectedOrder?.key ?? ''} onChange={(event) => setSelection(event.target.value)}>{orders.map(({ snapshot, order, key }) => <option key={key} value={key}>{snapshot.funds.find((fund) => fund.code === order.code)?.name ?? order.code} · {order.side === 'sell' ? '卖出' : '买入'} {order.quantity}{order.unit === 'shares' ? '份' : '元'} · {order.operationAt.replace('T', ' ')}（记录 {snapshot.date}）</option>)}</select></label>}
  </div>;
  return <><button type="button" className="alipay-text-button" onClick={() => { setMode(positions.length ? 'holding' : 'order'); setSelection(''); setOpen(true); }}>手动修正</button>
    {open && (mode === 'holding' && position ? <AlipayHoldingDialog key={position.key} item={position.item} market={markets[position.item.id]} onClose={close} onSave={(patch) => { onUpdate(position.group, position.item.id, patch); onSaved('持仓已修正'); }}>{controls}</AlipayHoldingDialog>
      : mode === 'order' && selectedOrder ? <OrderDialog key={selectedOrder.key} snapshot={selectedOrder.snapshot} order={selectedOrder.order} onClose={close} onSaved={() => onSaved('交易记录已修正')}>{controls}</OrderDialog>
        : <AlipayImportDialog title="支付宝手动修正" onClose={close} footer={<button type="button" className="alipay-text-button" onClick={close}>取消</button>}>{controls}<div>{mode === 'holding' ? '暂无持仓' : '暂无导入交易'}</div></AlipayImportDialog>)}
  </>;
}
