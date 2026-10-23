import { useState } from 'react';
import type { AlipayActualSnapshot } from '../models/types';
import { importAlipaySnapshotToLedger } from '../utils/alipayLedgerImport';

export default function AlipayCorrectionButton({ snapshot, onSynced }: { snapshot: AlipayActualSnapshot; onSynced: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <>
    <button type="button" className="alipay-text-button" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try {
        const baseline = JSON.stringify(snapshot);
        const result = await importAlipaySnapshotToLedger(snapshot, baseline);
        onSynced(result.message);
      } catch (cause) { setError(cause instanceof Error ? cause.message : '同步失败'); }
      finally { setBusy(false); }
    }}>{busy ? '同步中' : '更新持仓'}</button>
    {error && <span role="alert">{error}</span>}
  </>;
}
