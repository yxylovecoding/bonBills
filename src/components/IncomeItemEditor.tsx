import type { IncomeItem } from '../models/types';
import { dateLabel, daysUntilDate, type ResolvedIncomeItem } from '../utils/payroll';
import { TAX_RULE_PRESETS } from '../utils/tax';
import AmountInput from './AmountInput';
import { formatCurrency } from './CurrencyDisplay';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', sub: '#5f6368', orange: '#e8710a' };
interface Props {
  item: ResolvedIncomeItem;
  today: Date;
  onChange: (field: keyof IncomeItem, raw: string) => void;
  onToggleActive: () => void;
  onToggleDailyRate: () => void;
  onToggleTaxRule: () => void;
  onSetTaxRule: (text: string) => void;
  onRemove: () => void;
}
export default function IncomeItemEditor({ item, today, onChange, onToggleActive, onToggleDailyRate, onToggleTaxRule, onSetTaxRule, onRemove }: Props) {
  const isDailyMode = item.dailyRate !== undefined;
  const hasTaxRule = Boolean(item.taxRuleText?.trim());
  const daysToNext = daysUntilDate(item.resolvedPayDate, today);
  const isPending = daysToNext >= 0 && daysToNext <= 3;
  const payrollCycle = item.payrollCycle;
  return (
    <div key={item.id} style={{ backgroundColor: isPending ? '#e6f4ea' : '#f8f9fa', borderRadius: 12, padding: '10px 12px', border: `1.5px solid ${isPending ? '#81c995' : '#e0e0e0'}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <button type="button" aria-label={`${item.isActive ? '停用' : '启用'}${item.name}`} aria-pressed={item.isActive} onClick={onToggleActive} style={{ flexShrink: 0, width: 18, height: 18, borderRadius: '50%', border: `2px solid ${item.isActive ? C.green : '#dadce0'}`, backgroundColor: item.isActive ? C.green : '#fff', cursor: 'pointer' }} />
        <input aria-label="收入名称" value={item.name} onChange={(e) => onChange('name', e.target.value)} style={{ flex: 1, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, color: item.isActive ? '#202124' : '#9aa0a6', minWidth: 0 }} />
        <button onClick={() => onToggleDailyRate()} style={{ flexShrink: 0, fontSize: 11, padding: '2px 8px', borderRadius: 6, border: `1px solid ${isDailyMode ? C.orange : '#dadce0'}`, backgroundColor: isDailyMode ? '#fff4e8' : '#f1f3f4', color: isDailyMode ? C.orange : C.sub, cursor: 'pointer', fontWeight: 600 }}>
          {isDailyMode ? '日薪' : '固定'}
        </button>
        <button onClick={() => onToggleTaxRule()} style={{ flexShrink: 0, fontSize: 11, padding: '2px 8px', borderRadius: 6, border: `1px solid ${hasTaxRule ? C.red : '#dadce0'}`, backgroundColor: hasTaxRule ? '#fce8e6' : '#f1f3f4', color: hasTaxRule ? C.red : C.sub, cursor: 'pointer', fontWeight: 600 }}>
          扣税
        </button>
        <button type="button" aria-label={`删除${item.name}`} onClick={onRemove} style={{ flexShrink: 0, background: 'none', border: 'none', color: '#dadce0', fontSize: 16, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {item.isInternPayroll && payrollCycle ? (
          <>
            <span style={{ fontSize: 11, color: C.sub }}>最后一个工作日发薪</span>
            <span style={{ fontSize: 11, color: C.blue, fontWeight: 600 }}>{dateLabel(payrollCycle.payDate)}</span>
            <span style={{ fontSize: 11, color: C.sub }}>截止</span>
            <span style={{ fontSize: 11, color: C.orange, fontWeight: 600 }}>{dateLabel(payrollCycle.cutoffDate)}</span>
            <span style={{ fontSize: 11, color: C.sub }}>
              区间 {dateLabel(payrollCycle.periodStartExclusive)} 后至 {dateLabel(payrollCycle.periodEndInclusive)}
            </span>
            <span style={{ flex: 1 }} />
          </>
        ) : (
          <>
            <span style={{ fontSize: 11, color: C.sub }}>每月</span>
            <input type="number" inputMode="numeric" value={item.payDay === 0 ? '' : item.payDay} placeholder={item.payDay === 0 ? '末' : ''}
              onChange={(e) => onChange('payDay', e.target.value || '0')}
              onFocus={(e) => e.target.select()}
              style={{ width: 36, border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, color: C.blue, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
            />
            <span style={{ fontSize: 11, color: C.sub }}>{item.payDay === 0 ? '月底发薪' : '号发薪'}</span>
            <button onClick={() => onChange('payDay', item.payDay === 0 ? '1' : '0')} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, border: `1px solid ${item.payDay === 0 ? C.blue : '#dadce0'}`, backgroundColor: item.payDay === 0 ? '#e8f0fe' : '#f1f3f4', color: item.payDay === 0 ? C.blue : C.sub, cursor: 'pointer' }}>
              月底
            </button>
            <span style={{ flex: 1 }} />
          </>
        )}
        {isDailyMode ? (
          <>
            <span style={{ fontSize: 11, color: C.sub }}>¥</span>
            <AmountInput aria-label="日薪金额" value={String(item.dailyRate ?? 0)} onFocus={(e) => e.target.select()}
              onChange={(v) => onChange('dailyRate', /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v)}
              style={{ width: 60, border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, color: C.orange, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
            />
            <span style={{ fontSize: 11, color: C.sub }}>/天 × {item.resolvedDayCount ?? 0}天</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.green, fontVariantNumeric: 'tabular-nums' }}>= ¥{formatCurrency(item.grossAmount)}</span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 11, color: C.sub }}>¥</span>
            <AmountInput value={String(item.amount ?? '')} onFocus={(e) => e.target.select()}
              onChange={(v) => onChange('amount', /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v)}
              style={{ width: 80, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: C.green, textAlign: 'right' }}
            />
          </>
        )}
      </div>
      {hasTaxRule && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TAX_RULE_PRESETS.map((preset) => {
              const active = item.taxRuleText === preset.text;
              return (
                <button
                  key={preset.key}
                  onClick={() => onSetTaxRule(preset.text)}
                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, border: `1px solid ${active ? C.red : '#dadce0'}`, backgroundColor: active ? '#fce8e6' : '#fff', color: active ? C.red : C.sub, cursor: 'pointer', fontWeight: 600 }}
                >
                  {preset.label}
                </button>
              );
            })}
            <button
              onClick={() => onSetTaxRule(item.taxRuleText?.trim() ? item.taxRuleText : '税=')}
              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, border: `1px solid ${TAX_RULE_PRESETS.some((preset) => preset.text === item.taxRuleText) ? '#dadce0' : C.blue}`, backgroundColor: TAX_RULE_PRESETS.some((preset) => preset.text === item.taxRuleText) ? '#fff' : '#e8f0fe', color: TAX_RULE_PRESETS.some((preset) => preset.text === item.taxRuleText) ? C.sub : C.blue, cursor: 'pointer', fontWeight: 600 }}
            >
              自定义
            </button>
          </div>
          <input
            value={item.taxRuleText ?? ''}
            onChange={(e) => onChange('taxRuleText', e.target.value)}
            placeholder="例：税=(0.8x-5000)*20%；税=(0.8*收入-5000)*0.2"
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #fad2cf', borderRadius: 8, outline: 'none', backgroundColor: '#fff', fontSize: 12, color: '#202124', padding: '6px 8px' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 11 }}>
            <span style={{ color: item.taxRuleError ? C.red : C.sub }}>
              {item.taxRuleError ?? item.taxRuleSummary ?? '已启用扣税'}
            </span>
            <span style={{ color: C.sub, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              税前 ¥{formatCurrency(item.grossAmount)} - 税 ¥{formatCurrency(item.taxAmount)} = 到手 ¥{formatCurrency(item.resolvedAmount)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
