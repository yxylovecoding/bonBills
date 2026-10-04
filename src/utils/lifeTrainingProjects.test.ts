import { describe, expect, it } from 'vitest';
import { DEFAULT_CYCLE } from './bonLife';
import { automaticTraining, parseTrainingSettings, recordedTrainingProjects, reuseTrainingProjects, rollingTrainingPlan, trainingIdentity, trainingLibrary,
  type TrainingSettings, type TrainingTask } from './lifeTraining';

const source = (name: string): TrainingTask => ({ id: name, name, title: `${name}-运动💪🏻是生活的第一个锚点🪝`, notes: '原有跟练', links: [{ title: '跟练', url: 'https://example.com/workout' }], schedule: '每周三', dates: [] });
const settings: TrainingSettings = { revision: '', projects: [{ key: '爬坡', name: '爬坡', notes: '30 分钟', rotation: true }] };
const roll = (tasks: TrainingTask[], entries = {}) => rollingTrainingPlan(2026, 10, '2026-10-05', { year: 2026, tasks, connected: false, syncedAt: null }, DEFAULT_CYCLE, [], entries);

describe('可复用训练项目', () => {
  it('预置爬坡、游泳，TickTick 同名游泳只出现一次且保留轮换和跟练', () => {
    const library = trainingLibrary([source('游泳'), source('有氧')]);
    expect(library.map((task) => task.name)).toEqual(['爬坡', '游泳', '有氧']);
    expect(library[0].rotation).toBe(false);
    expect(library[1]).toMatchObject({ rotation: true, notes: '原有跟练', links: source('游泳').links });
    expect(roll(library).coverage.map(({ task }) => task.name)).toEqual(['有氧', '游泳']);
  });
  it('保存的名称与内容可跨日复用，修改项目不会改写已保存的记录', () => {
    const library = trainingLibrary([], settings);
    const first = reuseTrainingProjects([library[0]]);
    expect(first).toMatchObject({ plan: '爬坡 · 30 分钟', projects: ['爬坡'], mode: 'manual', completed: false });
    const renamed = trainingLibrary([], { ...settings, projects: [{ ...settings.projects[0], name: '坡度走', notes: '40 分钟' }] });
    expect(reuseTrainingProjects([renamed[0]]).plan).toBe('坡度走 · 40 分钟');
    expect(first.plan).toBe('爬坡 · 30 分钟');
    const entries = { 'training:2026-10-04': { text: '', revision: '', training: { ...first, completed: true } } };
    expect(roll(renamed, entries).coverage[0]).toMatchObject({ completed: true, lastCompleted: '2026-10-04' });
    expect(recordedTrainingProjects(automaticTraining('2026-10-05', [renamed[0]], DEFAULT_CYCLE, []), renamed)).toEqual(['爬坡']);
  });
  it('自建项目可参加滚动轮换，取消轮换后仍可选择并保留完成历史', () => {
    const custom = { key: 'custom-yoga', name: '瑜伽', notes: '', rotation: true };
    const tasks = trainingLibrary([], { revision: '', projects: [custom] });
    expect(roll(tasks).plans.get('2026-10-05')?.projects).toEqual(['custom-yoga']);
    const entry = { text: '', revision: '', training: { ...reuseTrainingProjects([tasks.find((task) => trainingIdentity(task) === custom.key)!]), completed: true } };
    const paused = trainingLibrary([], { revision: '', projects: [{ ...custom, rotation: false }] });
    expect(roll(paused, { 'training:2026-10-04': entry }).plans.get('2026-10-04')).toBe(entry.training);
    expect(roll(paused).coverage).toEqual([]);
    expect(roll(paused).plans.get('2026-10-05')?.projects).toEqual([]);
    expect(paused.some((task) => task.name === '瑜伽')).toBe(true);
  });
  it('手动选择后恢复自动安排仍使用轮换建议，游泳项目继续避开经期', () => {
    const tasks = trainingLibrary([source('有氧')], settings);
    const picked = reuseTrainingProjects([tasks.find((task) => task.name === '爬坡')!]);
    const entries = { 'training:2026-10-05': { text: '', revision: '', training: picked } };
    expect(roll(tasks, entries).plans.get('2026-10-05')).toBe(picked);
    expect(roll(tasks, entries).byDate.get('2026-10-05')).toEqual(roll(tasks).byDate.get('2026-10-05'));
    const swimming = trainingLibrary([], { revision: '', projects: [{ key: '游泳', name: '游泳', notes: '', rotation: true }] });
    const result = rollingTrainingPlan(2026, 10, '2026-10-05', { year: 2026, tasks: swimming, connected: false, syncedAt: null },
      { ...DEFAULT_CYCLE, lastPeriodStart: '2026-10-01' }, [], {});
    expect(result.plans.get('2026-10-05')?.projects).toEqual([]);
    expect(result.plans.get('2026-10-08')?.projects).toEqual(['游泳']);
  });
  it('限制空名称、重复名称、重复标识和过长内容', () => {
    expect(parseTrainingSettings(settings)).toEqual(settings);
    for (const project of [{ ...settings.projects[0], name: ' ' }, { ...settings.projects[0], key: '' },
      { ...settings.projects[0], notes: 'a'.repeat(501) }, { ...settings.projects[0], rotation: 'yes' }]) {
      expect(() => parseTrainingSettings({ ...settings, projects: [project] })).toThrow();
    }
    expect(() => parseTrainingSettings({ ...settings, projects: [...settings.projects, { ...settings.projects[0], key: 'different' }] })).toThrow('不能重复');
    expect(() => parseTrainingSettings({ ...settings, projects: [...settings.projects, { ...settings.projects[0], name: '另一项' }] })).toThrow('不能重复');
    expect(() => reuseTrainingProjects([source('有氧'), { ...source('游泳'), notes: 'a'.repeat(1000) }])).toThrow('内容过长');
  });
});
