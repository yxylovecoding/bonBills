import { describe, expect, it } from 'vitest';
import type { AppConfig, InternshipPeriod } from '../models/types';
import { BEIJING, DEFAULT_INTERNSHIP_RULES, migratedProfiles } from './internship';
import { internshipPayrolls } from './internshipPayroll';
import { payrollCutoffMarkerDates } from './payroll';
import { mergeSyncValue } from './syncMerge';

const income = { id: 'intern', name: '实习', amount: 0, payDay: 1, dailyRate: 500, tagKind: 'intern' as const, isActive: true };
const byte = migratedProfiles({ incomeItems: [income] })[0];
const other = { id: 'other', name: '广州公司', revision: 1, rules: { ...DEFAULT_INTERNSHIP_RULES, salary: 300, cycle: 'cutoff' as const } };
const period: InternshipPeriod = {
  id: 'byte-period', profileId: byte.id, profileName: byte.name, revision: byte.revision, rules: byte.rules,
  startDate: '2026-10-01', endDate: '2026-10-10', city: BEIJING, schoolCity: BEIJING,
};
const config: Partial<AppConfig> = {
  incomeItems: [income], internshipProfiles: [byte, other],
  internshipPeriods: [period, { ...period, id: 'other-period', profileId: other.id, profileName: other.name, rules: other.rules, startDate: '2026-10-11', endDate: '2026-10-31' }],
};

describe('公司模式中的截止日标记', () => {
  it('未配置实习段的字节模式沿用原来的显示选择', () => {
    const legacy = { config: { incomeItems: [income] } };
    expect(payrollCutoffMarkerDates(legacy, {}, 2026, 9, true)).toEqual(['2026-10-24']);
    expect(payrollCutoffMarkerDates(legacy, {}, 2026, 9, false)).toEqual([]);
    expect(payrollCutoffMarkerDates({ config: {} }, {}, 2026, 9, true)).toEqual([]);
  });

  it('旧开关只作为字节的回退，其他公司按自己的截薪日显示', () => {
    expect(payrollCutoffMarkerDates({ config }, {}, 2026, 9, false)).toEqual(['2026-10-25']);
    expect(payrollCutoffMarkerDates({ config }, {}, 2026, 9, true)).toEqual(['2026-10-24', '2026-10-25']);
    const saved = { ...config, internshipProfiles: [{ ...byte, showPayrollCutoffMarkers: true }, { ...other, showPayrollCutoffMarkers: false }] };
    expect(payrollCutoffMarkerDates({ config: saved }, {}, 2026, 9, false)).toEqual(['2026-10-24']);
  });

  it('字节保存的选择优先于旧全局值，改名后仍保持归属', () => {
    const hidden = { incomeItems: [income], internshipProfiles: [{ ...byte, name: '字节实习', showPayrollCutoffMarkers: false }] };
    expect(payrollCutoffMarkerDates({ config: hidden }, {}, 2026, 9, true)).toEqual([]);
    expect(payrollCutoffMarkerDates({ config: { ...hidden, internshipProfiles: [{ ...byte, showPayrollCutoffMarkers: true }] } }, {}, 2026, 9, false)).toEqual(['2026-10-24']);
  });

  it('日期仍取实习段的规则版本，离职后的最后一期也保留标记', () => {
    const saved = { ...config, internshipPeriods: [period], internshipProfiles: [{ ...byte, rules: { ...byte.rules, cutoffOffset: 3 }, showPayrollCutoffMarkers: true }] };
    expect(payrollCutoffMarkerDates({ config: saved }, {}, 2026, 9)).toEqual(['2026-10-24']);
    expect(payrollCutoffMarkerDates({ config: saved }, {}, 2026, 10)).toEqual([]);
    expect(payrollCutoffMarkerDates({ config: { ...saved, internshipPeriods: [{ ...period, endDate: '' }], internshipEnabledFrom: '2026-10-01' } }, {}, 2026, 9)).toEqual([]);
  });

  it('不同公司同日截止只显示一次，其中一家公司关闭也不隐藏另一家', () => {
    const sameDay = { ...config, internshipPeriods: [period, { ...config.internshipPeriods![1], rules: { ...other.rules, cutoffDay: 24 } }] };
    expect(payrollCutoffMarkerDates({ config: sameDay }, {}, 2026, 9, true)).toEqual(['2026-10-24']);
    expect(payrollCutoffMarkerDates({ config: sameDay }, {}, 2026, 9, false)).toEqual(['2026-10-24']);
  });

  it('切换显示不改变工资、房补、税额、到账日或规则版本', () => {
    const before = internshipPayrolls({ config }, {}, '2026-10-01', '2026-10-31');
    const hidden = { ...config, internshipProfiles: config.internshipProfiles!.map(p => ({ ...p, showPayrollCutoffMarkers: false })) };
    expect(payrollCutoffMarkerDates({ config: hidden }, {}, 2026, 9)).toEqual([]);
    expect(internshipPayrolls({ config: hidden }, {}, '2026-10-01', '2026-10-31')).toEqual(before);
  });

  it('公司显示选择通过现有同步合并和备份恢复保留', () => {
    const base = { config };
    const local = { config: { ...config, internshipProfiles: [{ ...byte, showPayrollCutoffMarkers: false }, other] } };
    const remote = { config: { ...config, internshipProfiles: [byte, { ...other, showPayrollCutoffMarkers: true }] } };
    const merged = JSON.parse(JSON.stringify(mergeSyncValue(base, local, remote)));
    expect(merged.config.internshipProfiles).toEqual([{ ...byte, showPayrollCutoffMarkers: false }, { ...other, showPayrollCutoffMarkers: true }]);
    expect(payrollCutoffMarkerDates(merged, {}, 2026, 9)).toEqual(['2026-10-25']);
  });
});
