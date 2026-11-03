import { beforeEach, expect, it, vi } from 'vitest';
import { readOutlookConnections } from './_outlookConnections';
const m = vi.hoisted(() => ({ data: new Map<string, unknown>(), write: vi.fn(), decrypt: vi.fn() }));
vi.mock('./_accountKv.js', () => ({ kv: { get: async (key: string) => m.data.get(key) ?? null } }));
vi.mock('./_outlookCalendar.js', () => ({ decryptOutlookConnection: m.decrypt }));
vi.mock('./_outlookWrite.js', () => ({ outlookWriteStatus: m.write }));
beforeEach(() => { m.data.clear(); m.write.mockReset().mockResolvedValue({ connected: false }); m.decrypt.mockReset().mockReturnValue({ sources: [{ name: '玩', url: 'https://private/secret.ics' }, { name: '课', url: 'https://private/token.ics' }] }); });
it('未连接、仅读取和仅写入均独立显示，不泄露订阅或凭据', async () => {
  expect((await readOutlookConnections()).every(source => !source.connected)).toBe(true);
  m.data.set('outlook:calendar-connection:v1', { id: 'read', encrypted: 'secret' });
  m.data.set('outlook:calendar-snapshots:v1', { connectionId: 'read', requestedAt: 1793664000000 });
  const read = await readOutlookConnections(); expect(read.filter(source => source.kind === 'subscription').map(source => source.name)).toEqual(['玩', '课']);
  expect(read[0].syncedAt).toBeDefined(); expect(JSON.stringify(read)).not.toMatch(/secret|private|token|\.ics/);
  m.data.clear(); m.write.mockResolvedValue({ connected: true, enabled: true, calendarName: '工作', lastSyncAt: '2026-11-03T12:00:00Z', accessToken: 'secret' });
  const write = await readOutlookConnections(); expect(write.find(source => source.kind === 'write')).toMatchObject({ name: '工作 · 日程写入', connected: true });
  expect(write.find(source => source.kind === 'subscription')?.connected).toBe(false); expect(JSON.stringify(write)).not.toContain('secret');
});
it('经期、订阅和写入失败状态可见，重新读取反映连接管理变更', async () => {
  m.data.set('bonlife:outlook-connection:v1', { id: 'period' });
  m.data.set('bonlife:period-read-status:v1', { connectionId: 'period', error: '经期订阅同步失败，请检查连接' });
  m.data.set('outlook:calendar-connection:v1', { id: 'read' });
  m.data.set('outlook:calendar-read-status:v1', { connectionId: 'read', error: 'failed' });
  m.write.mockResolvedValue({ connected: true, error: 'Outlook 日程同步失败: https://private/secret.ics' });
  const result = await readOutlookConnections(); expect(result.every(source => !!source.error)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/secret|private|\.ics/);
  m.data.delete('outlook:calendar-connection:v1'); expect((await readOutlookConnections())[0].connected).toBe(false);
});
