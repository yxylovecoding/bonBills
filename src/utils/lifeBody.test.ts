import { describe, expect, it } from 'vitest';
import { entrySummary, parseLifeEdit, type BodyRecord, type LifeEntries } from './bonLife';
import { bodyDateLabel, bodySeries } from './lifeBody';
import { draftKey, readDraft } from '../life/client';

const edit = { kind: 'body', date: '2026-10-04', text: '晨起', revision: '', mutationId: 'mutation-123456789' };
const entry = (body?: BodyRecord) => ({ text: '', revision: '', body });

describe('身体数据记录', () => {
  it('体重、BMI、体脂率与旧体围共同保存、恢复，使用各自单位', () => {
    const body = { weight: 56.35, bmi: 21.47, bodyFat: 24.6, waist: 66.5 };
    expect(parseLifeEdit({ ...edit, body }).body).toEqual(body);
    expect(entrySummary('body', { ...entry(body), text: '晨起' })).toBe('体重 56.35 kg\nBMI 21.47\n体脂率 24.6 %\n腰围 66.5 cm\n晨起');
    localStorage.setItem(draftKey('body-tester'), JSON.stringify({ ...edit, body }));
    expect(readDraft('body-tester')?.body).toEqual(body);
    localStorage.removeItem(draftKey('body-tester'));
  });
  it('拒绝无效数据与错误单位量级，仍允许单项记录和清空', () => {
    for (const body of [{ weight: 501 }, { bmi: 151 }, { bodyFat: 100.1 }, { waist: 301 }, { weight: 0 }, { bmi: -1 }, { bodyFat: NaN }, { weight: Infinity }, { weight: '55' }, { unknown: 2 }]) {
      expect(() => parseLifeEdit({ ...edit, body })).toThrow();
    }
    expect(parseLifeEdit({ ...edit, body: { weight: 350 } }).body).toEqual({ weight: 350 });
    expect(parseLifeEdit({ ...edit, body: {} }).body).toEqual({});
  });
});

describe('身体历史曲线', () => {
  const entries: LifeEntries = {
    'body:2026-10-04': entry({ weight: 55, bmi: 21, bodyFat: 24, waist: 66 }),
    'body:2026-10-02': entry({ waist: 67 }),
    'body:2026-09-01': entry({ weight: 56, waist: 68 }),
    'body:2025-12-31': entry({ weight: 57 }),
    'body:2026-10-03': entry(),
    'skin:2026-10-01': entry({ weight: 99 }),
  };
  it('按真实日期排序与间隔绘制，旧体围仍出现在曲线中', () => {
    const points = bodySeries(entries, 'waist', 2026);
    expect(points.map(({ date, value }) => [date, value])).toEqual([['2026-09-01', 68], ['2026-10-02', 67], ['2026-10-04', 66]]);
    expect(points[2].time - points[1].time).toBe(2 * 86400000);
    expect(bodyDateLabel(points[2].time)).toBe('10/4');
  });
  it('月、年与往年范围独立，不把未测量日或其他记录填成零', () => {
    expect(bodySeries(entries, 'weight', 2026).map((point) => point.value)).toEqual([56, 55]);
    expect(bodySeries(entries, 'weight', 2026, 10).map((point) => point.value)).toEqual([55]);
    expect(bodySeries(entries, 'weight', 2025).map((point) => point.value)).toEqual([57]);
    expect(bodySeries(entries, 'weight', 2026, 1)).toEqual([]);
    expect(bodySeries(entries, 'chest', 2026)).toEqual([]);
    expect(bodySeries(entries, 'bmi', 2026).map((point) => point.value)).toEqual([21]);
    expect(bodySeries(entries, 'bodyFat', 2026).map((point) => point.value)).toEqual([24]);
  });
  it('修改与清空记录后更新曲线，不产生重复点或保留旧值', () => {
    const updated = { ...entries, 'body:2026-10-04': entry({ weight: 54.5 }) };
    expect(bodySeries(updated, 'weight', 2026, 10).map((point) => point.value)).toEqual([54.5]);
    expect(bodySeries(updated, 'waist', 2026, 10).map((point) => point.value)).toEqual([67]);
    expect(bodySeries({ ...updated, 'body:2026-10-04': entry({}) }, 'weight', 2026, 10)).toEqual([]);
  });
  it('支持闰日，忽略无效日期和历史坏值', () => {
    const history = { 'body:2024-02-29': entry({ bmi: 20 }), 'body:2024-02-30': entry({ bmi: 21 }),
      'body:2024-02-01': entry({ bmi: Infinity }), 'body:2024-02-02': entry({ bmi: 0 }) };
    expect(bodySeries(history, 'bmi', 2024)).toEqual([{ date: '2024-02-29', time: Date.parse('2024-02-29T00:00:00Z'), value: 20 }]);
  });
});
