import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ItemPhoto from './ItemPhoto';
import SavedOutfits from './SavedOutfits';
import { emptyContext } from './rules';
import type { ClothesItem, WearRecord } from './types';

const item: ClothesItem = { id: 'shirt', revision: 'original', name: '旧衬衫', category: '上衣', color: '白',
  thickness: 1, active: true, windproof: false, waterproof: false, status: '可穿', photoId: 'shirt-photo' };
const discarded: ClothesItem = { ...item, revision: 'discarded', status: '已丢弃' };

describe('已丢弃衣物的照片按需加载', () => {
  it('历史仍保存可穿快照时，依据衣柜最新状态不生成任何图片请求地址', () => {
    const html = renderToStaticMarkup(createElement(ItemPhoto, { item, current: discarded }));
    expect(html).toContain('查看旧衬衫的照片');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('/api/bonclothes');
  });
  it('已丢弃快照不会自行加载，放回衣柜后照片恢复正常显示', () => {
    expect(renderToStaticMarkup(createElement(ItemPhoto, { item: discarded }))).not.toContain('<img');
    expect(renderToStaticMarkup(createElement(ItemPhoto, { item: discarded, current: item }))).toContain('view=photo');
    expect(renderToStaticMarkup(createElement(ItemPhoto, { item, current: item }))).toContain('view=photo');
  });
  it('保存的搭配保留原衣物文字，丢弃后不加载照片且不能穿这套', () => {
    const context = emptyContext('2026-10-23', 'Asia/Shanghai');
    const outfit: WearRecord = { id: 'outfit', revision: 'outfit-revision', date: context.date, confirmedAt: '', kind: 'styled', items: [item], context, weather: null };
    const html = renderToStaticMarkup(createElement(SavedOutfits, { outfits: [outfit], items: [discarded], context, onOpenWear: () => undefined, hasWearDraft: false }));
    expect(html).not.toContain('<img');
    expect(html).toContain('旧衬衫');
    expect(html).toContain('部分衣物不可穿');
    expect(html).toMatch(/disabled="">穿这套/);
  });
});
