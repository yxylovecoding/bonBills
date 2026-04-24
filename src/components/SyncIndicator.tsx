import { useSyncStatus } from '../utils/syncStatus';

const META: Record<string, { icon: string; color: string; bg: string; label: string }> = {
  idle:    { icon: '☁️', color: '#5f6368', bg: 'transparent',  label: '已同步' },
  loading: { icon: '🌐', color: '#1a73e8', bg: '#e8f0fe',      label: '同步中…' },
  saving:  { icon: '⏫', color: '#1a73e8', bg: '#e8f0fe',      label: '保存中…' },
  saved:   { icon: '✓',  color: '#0d9488', bg: '#e6f4ea',      label: '已保存' },
  error:   { icon: '⚠️', color: '#ea4335', bg: '#fce8e6',      label: '同步失败' },
  offline: { icon: '🔒', color: '#9aa0a6', bg: '#f1f3f4',      label: '离线' },
};

export default function SyncIndicator() {
  const { state, message } = useSyncStatus();
  if (state === 'idle') return null;
  const m = META[state];
  return (
    <div
      style={{
        position: 'fixed', top: 8, right: 8, zIndex: 100,
        fontSize: 11, padding: '4px 10px', borderRadius: 12,
        backgroundColor: m.bg, color: m.color,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        display: 'flex', alignItems: 'center', gap: 4,
        pointerEvents: 'none', userSelect: 'none',
      }}
      title={message}
    >
      <span>{m.icon}</span>
      <span>{m.label}</span>
    </div>
  );
}
