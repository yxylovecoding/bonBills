import { describe, expect, it } from 'vitest';
import { itemInput, validLayers } from './_clothesValidation';
import type { ClothesItem } from '../src/clothes/types';

const item = (name: string, category: ClothesItem['category'], patch: Partial<ClothesItem> = {}): ClothesItem => ({
  id: 'item-123456789012', name, category, revision: '', photoId: '', color: '白', thickness: 1, active: true,
  windproof: false, waterproof: false, status: '可穿', ...patch,
});

describe('衣物保暖部位校验', () => {
  it('保存明确的多个部位和空覆盖，旧衣物不强制迁移', () => {
    expect(itemInput(item('多用围巾', '配饰', { warmthRegions: ['head', 'neck'], warmth: 3 }))).toMatchObject({ warmthRegions: ['head', 'neck'], warmth: 3 });
    expect(itemInput(item('装饰围巾', '配饰', { warmthRegions: [] })).warmthRegions).toEqual([]);
    expect(itemInput(item('帽子', '配饰')).warmthRegions).toBeUndefined();
  });
  it.each([null, 'head', ['unknown'], ['head', 'head']])('拒绝无效保暖部位 %j', (warmthRegions) => {
    expect(() => itemInput({ ...item('帽子', '配饰'), warmthRegions })).toThrow('保暖部位无效');
  });
  it('允许同时保存不同部位的配饰及鞋袜，继续拒绝同部位配饰与重复主体层', () => {
    const accessories = ['帽子', '口罩', '围巾', '袜子', '手套'].map((name) => item(name, '配饰'));
    expect(validLayers([...accessories, item('鞋', '鞋'), item('上衣', '上衣'), item('裤子', '下装')])).toBe(true);
    expect(validLayers([...accessories, item('另一帽子', '配饰')])).toBe(false);
    expect(validLayers([item('围巾帽', '配饰'), item('围巾', '配饰')])).toBe(false);
    expect(validLayers([item('上衣', '上衣'), item('另一上衣', '上衣')])).toBe(false);
    expect(validLayers([item('连衣裙', '连衣裙'), item('裤子', '下装')])).toBe(false);
  });
});
