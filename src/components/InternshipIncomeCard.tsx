import { useId, useState, type ReactNode } from 'react';
import type { AppConfig } from '../models/types';
import { internshipStart, migratedProfiles, periodReady } from '../utils/internship';
import { cityLabel } from '../utils/sceneCities';
import { dateLabel, daysUntilDate, type ResolvedIncomeItem } from '../utils/payroll';
import { formatCurrency } from './CurrencyDisplay';

interface Props {
  config: AppConfig;
  incomes: ResolvedIncomeItem[];
  today: Date;
  holidayWarning?: string;
  unavailableYears?: number[];
  settings: ReactNode;
}

export default function InternshipIncomeCard({ config, incomes, today, holidayWarning, unavailableYears = [], settings }: Props) {
  const [expanded, setExpanded] = useState(false);
  const settingsId = useId();
  const periods = config.internshipPeriods ?? [];
  const profiles = migratedProfiles(config);
  const started = internshipStart(config);
  const visibleIncomes = incomes.filter(item => item.internshipPayroll || !started || item.grossAmount > 0);
  const companyNames = [...new Set(profiles.map(p => p.name))].join(' · ');
  return <section aria-label="实习收入" style={{ background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: 12, padding: '10px 12px', marginBottom: 8 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <strong style={{ fontSize: 13 }}>实习</strong>
      <button type="button" aria-expanded={expanded} aria-controls={settingsId} onClick={() => setExpanded(value => !value)} style={{ border: 0, background: 'transparent', color: '#1a73e8', fontSize: 12, cursor: 'pointer', padding: '3px 0 3px 10px' }}>{expanded ? '收起设置' : '设置'}</button>
    </div>
    {!expanded && <>
      {periods.length > 0 ? periods.map(period => <button key={period.id} type="button" onClick={() => setExpanded(true)} aria-label={`编辑实习：${period.profileName || '公司未设置'}`} style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, padding: '6px 0', background: 'transparent', cursor: 'pointer', color: '#5f6368', fontSize: 11, lineHeight: 1.65 }}>
        <span style={{ color: '#202124', fontSize: 12 }}>{period.profileName || '公司未设置'} · {cityLabel(period.city) || '城市未设置'}</span>
        <br />{period.startDate || '开始日期'} — {period.endDate || '结束日期'}{!periodReady(period) ? ' · 草稿' : ''}
      </button>) : companyNames ? <div style={{ color: '#5f6368', fontSize: 12, marginTop: 4 }}>{companyNames}</div> : null}
    </>}
    {visibleIncomes.map(item => {
      const payroll = item.internshipPayroll;
      const daysToPay = daysUntilDate(item.resolvedPayDate, today);
      const pending = item.isActive && daysToPay >= 0 && daysToPay <= 3;
      const rate = payroll?.rules.salary ?? item.dailyRate;
      const isMonthly = payroll?.rules.salaryKind === 'monthly';
      const cutoff = payroll?.endDate ?? item.payrollCycle?.cutoffDate;
      return <div key={item.id} style={{ paddingTop: 7, paddingBottom: 3, opacity: item.isActive ? 1 : 0.55 }}>
        {visibleIncomes.length > 1 && <div style={{ fontSize: 11, color: '#5f6368', marginBottom: 3 }}>{payroll?.name ?? profiles.find(p => p.legacyIncomeId === item.id)?.name ?? item.name}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 12px' }}>
          <span style={{ fontSize: 12, color: '#5f6368' }}>{rate !== undefined && rate !== null ? `¥${rate.toLocaleString('zh-CN')}/${isMonthly ? '月' : '天'} · ` : ''}{item.resolvedDayCount ?? 0} 天</span>
          <span style={{ fontSize: 11, color: '#5f6368' }}>到手 <strong style={{ color: '#0d9488', fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(item.resolvedAmount)}</strong></span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', color: '#5f6368', fontSize: 11, marginTop: 4 }}>
          <span style={{ color: pending ? '#0d9488' : undefined }}>{pending ? (daysToPay === 0 ? '今天发薪' : `${dateLabel(item.resolvedPayDate)} 发薪 · ${daysToPay} 天后`) : `${dateLabel(item.resolvedPayDate)} 发薪`}</span>
          {cutoff && <span>{dateLabel(cutoff)} 截止</span>}
          {payroll && payroll.housingAmount !== 0 && <span>房补 ¥{formatCurrency(payroll.housingAmount)}</span>}
          {Boolean(item.taxAmount) && <span>扣税 ¥{formatCurrency(item.taxAmount)}</span>}
          {!item.isActive && <span>已停用</span>}
        </div>
        {item.taxRuleError && <div role="alert" style={{ color: '#c5221f', fontSize: 11, marginTop: 4 }}>{item.taxRuleError}</div>}
      </div>;
    })}
    {visibleIncomes.length === 0 && <div style={{ color: '#5f6368', fontSize: 12, marginTop: 8 }}>本月暂无实习收入</div>}
    {holidayWarning && <details style={{ color: '#b06000', fontSize: 11, marginTop: 8 }}>
      <summary style={{ cursor: 'pointer' }}>{unavailableYears.length ? `${unavailableYears.join('、')} 年` : ''}节假日待更新</summary>
      <div style={{ marginTop: 5, lineHeight: 1.6 }}>{holidayWarning}</div>
    </details>}
    {expanded && <div id={settingsId} style={{ borderTop: '1px solid #e0e0e0', marginTop: 10, paddingTop: 2 }}>{settings}</div>}
  </section>;
}
