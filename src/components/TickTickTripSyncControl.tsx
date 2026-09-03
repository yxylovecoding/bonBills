import { useEffect, useState } from 'react';
import { getActiveSyncSecret } from '../utils/syncEngine';
import {
  connectTickTick,
  disconnectTickTick,
  loadTickTickSyncStatus,
  syncTickTickTrips,
  useTickTickSyncStatus,
} from '../utils/tickTickSync';

const BUTTON_STYLE: React.CSSProperties = {
  border: '1px solid #dadce0',
  borderRadius: 7,
  background: '#fff',
  color: '#1a73e8',
  cursor: 'pointer',
  fontSize: 11,
  padding: '4px 7px',
};

export default function TickTickTripSyncControl() {
  const { connection, operation, message } = useTickTickSyncStatus();
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const secret = getActiveSyncSecret();

  useEffect(() => {
    if (secret) void loadTickTickSyncStatus(secret);
  }, [secret]);

  if (!secret) return null;
  const busy = operation === 'connecting' || operation === 'syncing';
  const connected = connection === 'connected';
  const label = operation === 'connecting'
    ? '连接中…'
    : operation === 'syncing'
      ? '同步中…'
      : operation === 'error'
        ? '同步失败'
        : connected
          ? 'TickTick 已同步'
          : 'TickTick 未连接';

  return (
    <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #f1f3f4' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span title={message || undefined} style={{ fontSize: 12, color: operation === 'error' ? '#ea4335' : '#5f6368' }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {connected ? (
            <>
              <button type="button" disabled={busy} onClick={() => void syncTickTickTrips(secret)} style={BUTTON_STYLE}>
                立即同步
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void disconnectTickTick(secret)}
                style={{ ...BUTTON_STYLE, color: '#5f6368', border: 'none', background: 'transparent' }}
              >
                断开
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => setEditing((value) => !value)} style={BUTTON_STYLE}>
              连接
            </button>
          )}
        </div>
      </div>
      {editing && !connected && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!token.trim()) return;
            void connectTickTick(secret, token.trim()).then(() => {
              setToken('');
              setEditing(false);
              return syncTickTickTrips(secret);
            }).catch(() => undefined);
          }}
          style={{ display: 'flex', gap: 6, marginTop: 8 }}
        >
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="API Token"
            aria-label="TickTick API Token"
            style={{ flex: 1, minWidth: 0, border: '1px solid #dadce0', borderRadius: 7, padding: '6px 8px', fontSize: 12 }}
          />
          <button type="submit" disabled={!token.trim() || busy} style={BUTTON_STYLE}>保存</button>
        </form>
      )}
      {message && <div style={{ marginTop: 6, fontSize: 11, color: '#ea4335' }}>{message}</div>}
    </div>
  );
}
