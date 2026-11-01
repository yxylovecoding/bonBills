import { beforeEach, expect, it, vi } from 'vitest';
import { syncTickTickTemplates, templatePairs } from './_ticktickTemplateSync';
import type { TickTickTask, TickTickOpenApiClient } from './_ticktickTrips';
const m = vi.hoisted(() => ({ tasks: [] as TickTickTask[], saved: new Map<string, unknown>() }));
vi.mock('./_accountKv.js', () => ({ kv: { get: async (k: string) => structuredClone(m.saved.get(k)), set: async (k: string, v: unknown) => { m.saved.set(k, structuredClone(v)); } } }));
vi.mock('./_ticktickTrips.js', () => ({ readAllTickTickTasks: async () => structuredClone(m.tasks) }));
const titles = ['🪥漱', '🧴护', '💄妆', '🛀浴', '📷相机', '🧥', '随身背包', '⚪️小袋子', '⚫️小袋子', '【⚪️】'];
const make = (id: string, title: string, parentId?: string): TickTickTask => ({ id, title, projectId: 'p', parentId, content: 'same', tags: ['routine'], dueDate: '2026-11-04', items: [{ id: `${id}-item`, title: '牙刷', status: 1 }] });
const getTask = vi.fn(async (_p: string, id: string) => structuredClone(m.tasks.find(t => t.id === id)!));
const updateTask = vi.fn(async (id: string, payload: any) => { Object.assign(m.tasks.find(t => t.id === id)!, payload); return payload; });
const api = { getTask, updateTask } as unknown as TickTickOpenApiClient;
beforeEach(() => { m.saved.clear(); vi.clearAllMocks(); m.tasks = [make('travel', '出门todo模板'), make('move', '搬家模板'), make('a', '出门前一天', 'travel'), make('b', '出门前三天', 'move'), ...titles.flatMap((title, i) => [make(`a${i}`, `🧳${title}`, 'a'), make(`b${i}`, i === 9 ? '📦' : `📦${title}`, 'b')])]; });
it('matches ten second-level pairs including the special container pair and ignores copies', () => {
  m.tasks.push(make('copy', '🧳🪥漱', 'other'));
  const pairs = templatePairs(m.tasks, 'travel', { pairs: {} });
  expect(Object.keys(pairs)).toHaveLength(10); expect(pairs['白色行李袋'].ids).toEqual(['a9', 'b9']);
});
it('propagates later edits in either direction and stays idempotent, preserving container, dates, tags and progress', async () => {
  await syncTickTickTemplates(api, 'travel', 'conn');
  Object.assign(m.tasks.find(t => t.id === 'b0')!, { title: '📦🪥漱新版', content: 'new', items: [{ title: '牙刷', status: 0 }, { title: '牙线', status: 0 }] });
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(m.tasks.find(t => t.id === 'a0')).toMatchObject({ title: '🧳🪥漱新版', content: 'new', parentId: 'a', dueDate: '2026-11-04', tags: ['routine'], items: [{ id: 'a0-item', title: '牙刷', status: 1 }, { title: '牙线', status: 0 }] });
  m.tasks.find(t => t.id === 'a0')!.content = 'travel edit';
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(m.tasks.find(t => t.id === 'b0')!.content).toBe('travel edit');
  updateTask.mockClear(); await syncTickTickTemplates(api, 'travel', 'conn'); expect(updateTask).not.toHaveBeenCalled();
});
it('uses real modification times for initial differences and preserves the special titles', async () => {
  Object.assign(m.tasks.find(t => t.id === 'a9')!, { content: 'latest', modifiedTime: '2026-11-01T12:00:00Z' });
  Object.assign(m.tasks.find(t => t.id === 'b9')!, { modifiedTime: '2026-10-31T12:00:00Z' });
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(m.tasks.find(t => t.id === 'b9')).toMatchObject({ title: '📦', content: 'latest' });
});
it('does not guess when both sides change without modification timestamps', async () => {
  await syncTickTickTemplates(api, 'travel', 'conn');
  m.tasks.find(t => t.id === 'a0')!.content = 'A'; m.tasks.find(t => t.id === 'b0')!.content = 'B';
  await expect(syncTickTickTemplates(api, 'travel', 'conn')).rejects.toThrow('冲突'); expect(updateTask).not.toHaveBeenCalled();
});
it('rejects ambiguous and missing matches before writes', async () => {
  m.tasks.push(make('duplicate', '📦🪥漱', 'b'));
  await expect(syncTickTickTemplates(api, 'travel', 'conn')).rejects.toThrow('多个匹配'); expect(updateTask).not.toHaveBeenCalled();
});

it('initializes differences from travel when timestamps are unavailable, as explicitly authorized', async () => {
  m.tasks.find(t => t.id === 'a0')!.content = 'travel';
  m.tasks.find(t => t.id === 'b0')!.content = 'moving';
  await syncTickTickTemplates(api, 'travel', 'conn');
  expect(m.tasks.find(t => t.id === 'b0')!.content).toBe('travel');
});
