import { useState } from 'react';
import type { InvestPositionGroupKey, InvestPositionItems } from '../models/types';
import type { InvestPositionDraft } from '../utils/investPositionDrafts';
import { INVEST_POSITION_GROUP_KEYS, type InvestMarketSnapshot } from '../utils/investPositionItems';
import AlipayImportDialog from './AlipayImportDialog';
import { AlipayHoldingDialog } from './AlipayHoldingEditor';

export default function AlipayManualCorrection({ items, markets, onUpdate, onSaved }: {
  items: InvestPositionItems; markets: Record<string, InvestMarketSnapshot | undefined>;
  onUpdate: (group: InvestPositionGroupKey, id: string, patch: Partial<InvestPositionDraft>) => void; onSaved: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState('');
  const positions = INVEST_POSITION_GROUP_KEYS.filter((key) => key !== 'account' && key !== 'aggregate')
    .flatMap((group) => (items[group] ?? []).map((item) => ({ group, item, key: `${group}:${item.id}` })));
  const position = positions.find((entry) => entry.key === selection) ?? positions[0];
  const close = () => setOpen(false);
  return <><button type="button" className="alipay-text-button" onClick={() => { setSelection(''); setOpen(true); }}>手动修正</button>
    {open && (position ? <AlipayHoldingDialog key={position.key} item={position.item} market={markets[position.item.id]} onClose={close} onSave={(patch) => { onUpdate(position.group, position.item.id, patch); onSaved('持仓已修正'); }}>
      <label className="alipay-import-fund-choice">选择持仓<select aria-label="选择持仓" value={position.key} onChange={(event) => setSelection(event.target.value)}>{positions.map((entry) => <option key={entry.key} value={entry.key}>{entry.item.name} · {entry.item.symbol}</option>)}</select></label>
    </AlipayHoldingDialog> : <AlipayImportDialog title="支付宝持仓修正" onClose={close} footer={<button type="button" className="alipay-text-button" onClick={close}>取消</button>}><div>暂无持仓</div></AlipayImportDialog>)}
  </>;
}
