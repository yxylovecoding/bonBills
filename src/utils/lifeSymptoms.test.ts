import { describe, expect, it } from 'vitest';
import { entrySummary, parseLifeEdit, type LifeEntries } from './bonLife';
import { parseSymptomNames, parseSymptomRecord, reusableSymptom, symptomHistory, symptomKey, symptomObservations, type SymptomObservation } from './lifeSymptoms';

const bloodshot: SymptomObservation = { area: 'eye', name: '瞳孔周围一圈红血丝', status: 'appeared', note: '早上出现' };
const key = symptomKey(bloodshot.area, bloodshot.name);
const base = { kind: 'eyes', date: '2026-10-05', text: '', revision: '', mutationId: 'symptom-check-123456' };
const entry = (item: SymptomObservation) => ({ text: '', revision: 'r', eyes: { symptoms: { [symptomKey(item.area, item.name)]: item } } });

describe('症状复用与跟踪', () => {
  it('统一左右眼的同名旧记录，保留部位及原文，不推断变化', () => {
    const legacy = { leftEye: '红血丝', rightEye: '红血丝' };
    const symptoms = symptomObservations('eyes', legacy);
    expect(Object.values(symptoms)).toEqual([{ area: 'eye', name: '红血丝', status: 'recorded', note: '左眼、右眼' }]);
    expect(parseLifeEdit({ ...base, eyes: legacy }).eyes).toEqual(legacy);
    expect(entrySummary('eyes', { text: '原备注', revision: '', eyes: legacy })).toBe('红血丝 · 已记录 · 左眼、右眼\n原备注');
    expect(Object.values(symptomObservations('eyes', { leftEye: 'A', rightEye: 'B' })).map((item) => item.name)).toEqual(['A', 'B']);
  });
  it('旧身体文字保留三个部位，同名症状互不合并', () => {
    const symptoms = symptomObservations('discomfort', { leftSacroiliac: '酸胀', rightSacroiliac: '酸胀', lowerBack: '僵硬' });
    expect(Object.values(symptoms).map((item) => [item.area, item.name])).toEqual([
      ['leftSacroiliac', '酸胀'], ['rightSacroiliac', '酸胀'], ['lowerBack', '僵硬'],
    ]);
  });
  it('通用身体症状可结构化保存并跨日期连续跟踪备注和用药', () => {
    const itchy: SymptomObservation = { area: 'body', name: '身上痒', status: 'appeared', note: '晚饭后出现；氯雷他定 1 片' };
    const itchyKey = symptomKey(itchy.area, itchy.name);
    const first = parseLifeEdit({ ...base, kind: 'discomfort', discomfort: { symptoms: { [itchyKey]: itchy } } });
    expect(first.discomfort?.symptoms?.[itchyKey]).toEqual(itchy);
    expect(entrySummary('discomfort', first)).toContain('通用身体 · 身上痒 · 出现 · 晚饭后出现；氯雷他定 1 片');

    const history = symptomHistory('discomfort', {
      'discomfort:2026-10-05': { text: '', revision: 'r1', discomfort: first.discomfort },
      'discomfort:2026-10-06': { text: '', revision: 'r2', discomfort: { symptoms: {
        [itchyKey]: { ...itchy, status: 'improving', note: '服药后减轻' },
      } } },
    });
    expect(history[0].points.map(({ date, status, note }) => ({ date, status, note }))).toEqual([
      { date: '2026-10-06', status: 'improving', note: '服药后减轻' },
      { date: '2026-10-05', status: 'appeared', note: '晚饭后出现；氯雷他定 1 片' },
    ]);
    expect(reusableSymptom('body', '身上痒', '2026-10-07', history)).toEqual({
      area: 'body', name: '身上痒', status: 'ongoing', note: '',
    });
  });
  it('新症状往返保存，清空显式覆盖旧字段且保留备注', () => {
    const saved = parseLifeEdit({ ...base, eyes: { symptoms: { [key]: bloodshot } } });
    expect(saved.eyes?.symptoms?.[key]).toEqual(bloodshot);
    expect(entrySummary('eyes', saved)).toBe('瞳孔周围一圈红血丝 · 出现 · 早上出现');
    expect(symptomObservations('eyes', { leftEye: '旧记录', symptoms: {} })).toEqual({});
    expect(parseLifeEdit({ ...base, eyes: { symptoms: {} } }).eyes).toEqual({ symptoms: {} });
  });
  it.each([
    null, [], { symptoms: [] }, { symptoms: { [key]: { ...bloodshot, area: 'lowerBack' } } },
    { symptoms: { [key]: { ...bloodshot, status: 'invalid' } } }, { symptoms: { wrong: bloodshot } },
    { symptoms: { [key]: { ...bloodshot, name: '' } } }, { symptoms: { [key]: { ...bloodshot, note: '字'.repeat(501) } } },
    { symptoms: { [key]: { ...bloodshot, unexpected: true } } }, { weight: '50' },
  ])('拒绝无效症状记录 %j', (value) => {
    expect(() => parseSymptomRecord(value, 'eyes')).toThrow();
  });
  it('拒绝类型混用和过量症状；旧长文本仍可转换后保存', () => {
    expect(() => parseLifeEdit({ ...base, kind: 'mood', eyes: { symptoms: {} } })).toThrow();
    expect(() => parseSymptomRecord({ symptoms: { [key]: bloodshot } }, 'discomfort')).toThrow();
    const many = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`eye:s${i}`, { ...bloodshot, name: `s${i}` }]));
    expect(() => parseSymptomRecord({ symptoms: many }, 'eyes')).toThrow();
    const symptoms = symptomObservations('eyes', { leftEye: '字'.repeat(500) });
    expect(parseSymptomRecord({ symptoms }, 'eyes')).toEqual({ symptoms });
  });
  it('跨年按日期串起同一症状，保留消失状态，不计空记录或其他类型', () => {
    const entries: LifeEntries = {
      'eyes:2027-01-03': entry({ ...bloodshot, status: 'resolved', note: '' }),
      'eyes:2026-12-31': entry(bloodshot),
      'eyes:2027-01-02': entry({ ...bloodshot, status: 'improving', note: '淡了一些' }),
      'eyes:2027-01-04': { text: '', revision: '', eyes: { symptoms: {} } },
      'eyes:2027-02-30': entry(bloodshot),
      'mood:2027-01-05': { text: '情绪', revision: '' },
    };
    const result = symptomHistory('eyes', entries);
    expect(result).toHaveLength(1);
    expect(result[0].points.map((item) => [item.date, item.status])).toEqual([
      ['2027-01-03', 'resolved'], ['2027-01-02', 'improving'], ['2026-12-31', 'appeared'],
    ]);
    expect(symptomHistory('discomfort', entries)).toEqual([]);
  });
  it('名称去重忽略多余空格与大小写，身体部位仍独立', () => {
    expect(symptomKey('eye', '  Dry   EYE  ')).toBe(symptomKey('eye', 'dry eye'));
    expect(symptomKey('leftSacroiliac', '酸胀')).not.toBe(symptomKey('rightSacroiliac', '酸胀'));
  });
  it('复用只参考当天之前的状态，消失后再次记录为出现，备注不自动复制', () => {
    const history = symptomHistory('eyes', {
      'eyes:2026-10-01': entry(bloodshot),
      'eyes:2026-10-05': entry({ ...bloodshot, status: 'resolved' }),
    });
    expect(reusableSymptom('eye', bloodshot.name, '2026-09-30', history).status).toBe('appeared');
    expect(reusableSymptom('eye', bloodshot.name, '2026-10-03', history)).toMatchObject({ status: 'ongoing', note: '' });
    expect(reusableSymptom('eye', bloodshot.name, '2026-10-06', history).status).toBe('appeared');
  });
  it('未添加的名称可暂存，拒绝无效部位和内容', () => {
    expect(parseSymptomNames({ eye: '干涩' }, 'eyes')).toEqual({ eye: '干涩' });
    expect(parseSymptomNames({ lowerBack: '' }, 'discomfort')).toEqual({ lowerBack: '' });
    expect(parseSymptomNames({ body: '身上痒' }, 'discomfort')).toEqual({ body: '身上痒' });
    for (const invalid of [null, [], { eye: 1 }, { eye: '字'.repeat(501) }, { leftEye: '干涩' }, { lowerBack: '酸' }]) {
      expect(() => parseSymptomNames(invalid, 'eyes')).toThrow();
    }
  });
});
