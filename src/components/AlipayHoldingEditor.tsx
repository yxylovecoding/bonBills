import { useState } from 'react';
import type { InvestPositionItem } from '../models/types';
import type { InvestPositionDraft } from '../utils/investPositionDrafts';

const signature = (item: InvestPositionItem) => JSON.stringify([item.name, item.shares, item.costPrice, item.status]);

export default function AlipayHoldingEditor({ item, onSave }: {
  item: InvestPositionItem;
  onSave: (patch: Partial<InvestPositionDraft>) => void;
}) {
  const [draft, setDraft] = useState<{ name: string; shares: string; costPrice: string; status: InvestPositionItem['status']; baseline: string }>();
  const [error, setError] = useState('');
  if (!draft) return <button type="button" className="alipay-text-button" onClick={() => {
    setDraft({ name: item.name, shares: item.shares?.toString() ?? '', costPrice: item.costPrice?.toString() ?? '', status: item.status, baseline: signature(item) });
    setError('');
  }}>编辑持仓</button>;

  return <form className="inline-editor alipay-item-detail" aria-label={`${item.name}编辑持仓`} onSubmit={(event) => {
    event.preventDefault();
    if (draft.baseline !== signature(item)) { setError('持仓已更新，请重新编辑'); return; }
    if (!draft.name.trim() || [draft.shares, draft.costPrice].some((value) => value.trim() && (!Number.isFinite(Number(value)) || Number(value) < 0))) {
      setError('请填写名称及有效的份额、成本价'); return;
    }
    onSave({ name: draft.name.trim(), shares: draft.shares, costPrice: draft.costPrice, status: draft.status });
    setDraft(undefined);
  }}>
    <div className="inline-editor-body">
    <label className="alipay-detail-line">名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <label className="alipay-detail-line">账本份额<input type="number" min="0" step="any" value={draft.shares} onChange={(event) => setDraft({ ...draft, shares: event.target.value })} /></label>
    <label className="alipay-detail-line">账本成本价<input type="number" min="0" step="any" value={draft.costPrice} onChange={(event) => setDraft({ ...draft, costPrice: event.target.value })} /></label>
    <label className="alipay-detail-line">状态<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as InvestPositionItem['status'] })}>
      <option value="active">持有</option><option value="paused">历史</option>{draft.status === 'closed' && <option value="closed">已清仓</option>}
    </select></label>
    {error && <div role="alert">{error}</div>}
    </div>
    <div className="alipay-detail-line inline-editor-actions"><button type="submit" className="alipay-text-button">保存</button><button type="button" className="alipay-text-button" onClick={() => setDraft(undefined)}>取消</button></div>
  </form>;
}
