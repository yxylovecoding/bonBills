import { useEffect, useState } from 'react';
import {
  connectTickTick,
  disconnectTickTick,
  loadTickTickSyncStatus,
  syncTickTickTrips,
  saveTickTickDailyBudget,
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
  const { connection, operation, message, budgetMinutes, availabilityProfile, dailyPlan } = useTickTickSyncStatus();
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const [budget, setBudget] = useState('');
  const [profile, setProfile] = useState<'day' | 'evening' | 'calendar'>('day');
  useEffect(() => { setBudget(budgetMinutes == null ? '' : String(budgetMinutes)); }, [budgetMinutes]);
  useEffect(() => { setProfile(availabilityProfile ?? 'day'); }, [availabilityProfile]);

  useEffect(() => {
    void loadTickTickSyncStatus();
  }, []);

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
              <button type="button" disabled={busy} onClick={() => void syncTickTickTrips()} style={BUTTON_STYLE}>
                立即同步
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void disconnectTickTick()}
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
      {connected && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 8, fontSize: 11, color: '#5f6368' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            每日上限
            <input aria-label="每日上限" placeholder="自动" type="number" min={10} max={240} step={5} value={budget} disabled={busy}
              onChange={(event) => setBudget(event.target.value)}
              style={{ width: 44, border: '1px solid #dadce0', borderRadius: 5, padding: '3px 4px', fontSize: 11 }} />
            分钟
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            可用时段
            <select aria-label="可用时段" value={profile} disabled={busy} onChange={(event) => setProfile(event.target.value as typeof profile)}
              style={{ border: '1px solid #dadce0', borderRadius: 5, padding: '3px 4px', fontSize: 11 }}>
              <option value="day">09:00–22:00（排除餐休）</option><option value="evening">20:00–22:00</option><option value="calendar">跟随日历（排除餐休）</option>
            </select>
          </label>
          {(budget !== (budgetMinutes == null ? '' : String(budgetMinutes)) || profile !== (availabilityProfile ?? 'day')) && (
            <button type="button" style={BUTTON_STYLE} disabled={busy || (budget !== '' && (!Number.isInteger(Number(budget)) || Number(budget) < 10 || Number(budget) > 240))}
              onClick={() => { void saveTickTickDailyBudget(budget === '' ? null : Number(budget), profile).catch(() => undefined); }}>保存</button>
          )}
          {dailyPlan && <span>{dailyPlan.date.slice(5)} · {dailyPlan.todayCount} 项 · 约 {dailyPlan.plannedMinutes} 分钟</span>}
          {Boolean(dailyPlan?.cycleRiskCount) && <span style={{ color: '#e8710a' }}>{dailyPlan!.cycleRiskCount} 项周期紧张</span>}
          {Boolean(dailyPlan?.oversizedCount) && <span style={{ color: '#e8710a' }}>{dailyPlan!.oversizedCount} 项暂无空档</span>}
        </div>
      )}
      {editing && !connected && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!token.trim()) return;
            void connectTickTick(token.trim()).then(() => {
              setToken('');
              setEditing(false);
              return syncTickTickTrips();
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
