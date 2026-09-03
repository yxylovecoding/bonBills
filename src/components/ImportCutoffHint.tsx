import { formatImportCutoff } from '../utils/importCutoffs';

export default function ImportCutoffHint({
  investment,
  account,
}: {
  investment?: string;
  account?: string;
}) {
  return (
    <div
      title="理财增量起点与账户余额更新时间"
      style={{ display: 'flex', flexDirection: 'column', gap: 1, color: '#5f6368', fontSize: 9, lineHeight: 1.15, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
    >
      <span>理财 {formatImportCutoff(investment)} 起</span>
      <span>账户 {account ? `${formatImportCutoff(account)} 更新` : '待更新'}</span>
    </div>
  );
}
