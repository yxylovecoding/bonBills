import { useId, useState, type ReactNode } from 'react';
import type { InvestPositionItem } from '../models/types';
import type { InvestPositionDraft } from '../utils/investPositionDrafts';
import type { InvestMarketSnapshot } from '../utils/investPositionItems';
import { getAccountStorage } from '../utils/accountCache';
import { alipayHoldingDraft, alipayHoldingEditSignature, buildAlipayHoldingPatch } from '../utils/alipayManualCorrection';
import AlipayImportDialog from './AlipayImportDialog';

type Props = { item: InvestPositionItem; market?: InvestMarketSnapshot; onSave: (patch: Partial<InvestPositionDraft>) => void };

export function AlipayHoldingDialog({ item, market, onSave, onClose, children }: Props & { onClose: () => void; children?: ReactNode }) {
  const formId = useId();
  const [draft, setDraft] = useState(() => alipayHoldingDraft(item, market));
  const [baseline] = useState(() => alipayHoldingEditSignature(item, market));
  const [owner] = useState(getAccountStorage);
  const [error, setError] = useState('');
  const currency = (item.quoteCurrency || market?.currency || item.lastCurrency || 'CNY').toUpperCase();
  const hasPrice = !!alipayHoldingDraft(item, market).price;
  return <AlipayImportDialog title="支付宝手动修正" onClose={onClose} footer={<>
    {error && <div role="alert" className="alipay-import-warning">{error}</div>}
    <div className="alipay-detail-line"><button type="button" className="alipay-text-button" onClick={onClose}>取消</button><button type="submit" form={formId} className="alipay-import-confirm">保存</button></div>
  </>}>
    {children}
    <form id={formId} className="alipay-import-fields" onSubmit={(event) => {
      event.preventDefault();
      try {
        if (owner !== getAccountStorage()) throw new Error('账号已切换，请重新编辑');
        if (baseline !== alipayHoldingEditSignature(item, market)) throw new Error('持仓已更新，请关闭后重新编辑');
        onSave(buildAlipayHoldingPatch(item, draft, market));
        onClose();
      } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); }
    }}>
      <label className="alipay-import-fund-choice">名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>修正方式<select aria-label="修正方式" value={draft.mode} onChange={(event) => setDraft({ ...draft, mode: event.target.value as typeof draft.mode })}><option value="amount">金额与收益</option><option value="shares">份额与成本</option></select></label>
      <label>状态<select aria-label="状态" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as typeof draft.status })}><option value="active">持有</option><option value="paused">历史</option>{draft.status === 'closed' && <option value="closed">已清仓</option>}</select></label>
      {draft.mode === 'amount' ? <>
        <label>账本持有金额（{currency}）<input type="number" min="0" step="any" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /></label>
        <label>持有收益（{currency}）<input type="number" step="any" value={draft.profit} onChange={(event) => setDraft({ ...draft, profit: event.target.value })} /></label>
      </> : <>
        <label>账本份额<input type="number" min="0" step="any" value={draft.shares} onChange={(event) => setDraft({ ...draft, shares: event.target.value })} /></label>
        <label>账本成本价<input type="number" min="0" step="any" value={draft.costPrice} onChange={(event) => setDraft({ ...draft, costPrice: event.target.value })} /></label>
      </>}
      <label>净值<input type="number" min="0" step="any" readOnly={hasPrice} value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} /></label>
      <div className="alipay-detail-line">{item.symbol}</div>
    </form>
  </AlipayImportDialog>;
}

export default function AlipayHoldingEditor(props: Props) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="alipay-text-button" onClick={() => setOpen(true)}>手动修正</button>
    {open && <AlipayHoldingDialog {...props} onClose={() => setOpen(false)} />}</>;
}
