import { formatImportCutoff } from '../utils/importCutoffs';

export default function ImportCutoffHint({
  investment,
  bill,
}: {
  investment?: string;
  bill?: string;
}) {
  return (
    <div
      title="当前增量导入起点"
      style={{ display: 'flex', flexDirection: 'column', gap: 1, color: '#5f6368', fontSize: 9, lineHeight: 1.15, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
    >
      <span>理财 {formatImportCutoff(investment)} 起</span>
      <span>账单 {formatImportCutoff(bill)} 起</span>
    </div>
  );
}
