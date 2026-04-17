import { useMemo, useState } from 'react';
import Card from '../components/Card';
import StatRow from '../components/StatRow';
import CurrencyDisplay, { formatCurrency } from '../components/CurrencyDisplay';
import { useSnapshotStore } from '../stores/snapshotStore';
import { useConfigStore } from '../stores/configStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { usePrefsStore } from '../stores/prefsStore';
import { useCalendarStore } from '../stores/calendarStore';
import { tagMeta } from '../data/mockData';
import { calcHistoryStats } from '../calculations/history';
import { calcFire } from '../calculations/fire';
import type { IncomeItem, TagKind } from '../models/types';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', purple: '#7c3aed', sub: '#5f6368', orange: '#e8710a' };

function Divider() {
  return <div style={{ height: 1, backgroundColor: '#e8eaed', margin: '10px 0' }} />;
}

// 以万为单位格式化
function fmt万(v: number) {
  return (v / 10000).toFixed(2) + '万';
}

export default function HomePage() {
  const { current } = useSnapshotStore();
  const { config, setConfig } = useConfigStore();
  const { records } = useMonthlyStore();
  const { tagMap } = useCalendarStore();
  const { accountOrder } = usePrefsStore();

  const stats  = useMemo(() => calcHistoryStats(records), [records]);

  const totalInvest = Object.values(current.investHoldings).reduce((s, v) => s + v, 0);
  const netWorth = totalInvest + current.accounts.incomeBank + current.accounts.livingBank
                 + current.accounts.consumptionBank - current.accounts.credit;

  const today        = new Date();
  const daysInMonth  = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

  const monthlySurplus = stats.monthlyIncomeAvg - stats.totalExpenseAvg;

  // FIRE 模式切换：'life' = 周期+波动；'all' = 周期+波动+消费
  const [fireMode, setFireMode] = useState<'life' | 'all'>('all');
  const fireExpenseAvg = fireMode === 'life'
    ? stats.periodicLifeAvg + stats.volatileLifeAvg
    : stats.totalExpenseAvg;
  const fireStats = useMemo(
    () => ({ ...stats, totalExpenseAvg: fireExpenseAvg }),
    [stats, fireExpenseAvg],
  );
  const fire = useMemo(
    () => calcFire(config, fireStats, totalInvest),
    [config, fireStats, totalInvest],
  );

  // 当月各标签天数（用于日薪计算）
  const curYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const tagCountThisMonth = useMemo<Record<TagKind, number>>(() => {
    const counts: Record<TagKind, number> = { intern: 0, school: 0, home: 0, travel: 0 };
    for (const [date, tag] of Object.entries(tagMap)) {
      if (date.startsWith(curYM)) counts[tag]++;
    }
    return counts;
  }, [tagMap, curYM]);

  const getEffectiveAmount = (item: IncomeItem) =>
    item.dailyRate && item.tagKind ? item.dailyRate * tagCountThisMonth[item.tagKind] : item.amount;

  // 固定收入编辑
  const [localIncome, setLocalIncome] = useState<IncomeItem[]>(config.incomeItems);
  const syncIncome = (items: IncomeItem[]) => {
    setLocalIncome(items);
    setConfig({ incomeItems: items });
  };
  const updateIncomeField = (id: string, field: keyof IncomeItem, raw: string) => {
    const items = localIncome.map((item) => {
      if (item.id !== id) return item;
      if (field === 'amount')    return { ...item, amount: parseFloat(raw) || 0 };
      if (field === 'payDay')    return { ...item, payDay: parseInt(raw, 10) || 1 };
      if (field === 'name')      return { ...item, name: raw };
      if (field === 'dailyRate') return { ...item, dailyRate: parseFloat(raw) || undefined };
      return item;
    });
    syncIncome(items);
  };
  const toggleDailyRate = (id: string) => {
    const items = localIncome.map((item) => {
      if (item.id !== id) return item;
      if (item.dailyRate !== undefined) {
        const { dailyRate: _dr, tagKind: _tk, ...rest } = item;
        return rest as IncomeItem;
      }
      // 日薪模式固定用 intern（上班）
      return { ...item, dailyRate: 0, tagKind: 'intern' as TagKind };
    });
    syncIncome(items);
  };
  const addIncomeItem = () => {
    const newItem: IncomeItem = { id: `income_${Date.now()}`, name: '新收入', amount: 0, payDay: 1, isActive: true };
    syncIncome([...localIncome, newItem]);
  };
  const removeIncomeItem = (id: string) => syncIncome(localIncome.filter((i) => i.id !== id));

  // 信用卡还款提醒
  const d = today.getDate();
  const showPayWarning = d >= 8 && d <= config.creditPayDate;

  // 场景日均（用 tagMeta 标签）
  const sceneDailyRows = [
    { tagKind: 'school' as TagKind, val: stats.schoolDailyAvg },
    { tagKind: 'home'   as TagKind, val: 89.5 },
    { tagKind: 'intern' as TagKind, val: 156.3 },
    { tagKind: 'travel' as TagKind, val: 312.0 },
  ];

  // 账户余额显示（使用 accountOrder 偏好）
  const ACCT_META = {
    credit:     { icon: '💳', name: '信用卡 (待还)', bg: '#fce8e6', border: '#f28b82' },
    campusCard: { icon: '🎓', name: '校园卡',         bg: '#f1f3f4', border: '#dadce0' },
    livingBank: { icon: '🏦', name: '生活',           bg: '#e8f0fe', border: '#a8c7fa' },
  } as const;

  return (
    <div>
      {/* 页头：标题 + 人生时钟 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', margin: '0 0 16px' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 2px' }}>盘账助手</h1>
          <p style={{ fontSize: 13, color: C.sub, margin: 0 }}>
            {today.getFullYear()}年{today.getMonth() + 1}月 · 第 {today.getDate()} 天
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 30, fontWeight: 700, fontFamily: 'monospace', color: '#202124', letterSpacing: 1 }}>
            {fire.lifeClockStr}
          </div>
          <div style={{ fontSize: 11, color: C.sub }}>{fire.lifeClockPeriod}</div>
        </div>
      </div>

      {/* 卡片1: 财务概览（只显示净资产） */}
      <Card title="财务概览">
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>净资产</div>
          <CurrencyDisplay value={netWorth} size="xl" color={netWorth >= 0 ? C.blue : C.red} />
        </div>
      </Card>

      {/* 卡片2: 月度快照 */}
      <Card title="月度快照" subtitle="历史均值">
        <StatRow label="月均收入" value={<CurrencyDisplay value={stats.monthlyIncomeAvg} color={C.red} />} />
        <StatRow label="月均支出" value={<CurrencyDisplay value={stats.totalExpenseAvg} color={C.green} />} />
        <StatRow label="周期生活" indent value={<CurrencyDisplay value={stats.periodicLifeAvg} color={C.blue} />} />
        <StatRow label="波动生活" indent value={<CurrencyDisplay value={stats.volatileLifeAvg} color={C.blue} />} />
        <StatRow label="消费" indent value={<CurrencyDisplay value={stats.consumptionAvg} color={C.purple} />} />
        <Divider />
        <StatRow label="月均结余" value={<CurrencyDisplay value={monthlySurplus} color={monthlySurplus >= 0 ? C.green : C.red} />} />
        <StatRow
          label="储蓄率"
          value={<span style={{ color: stats.savingsRate >= 0 ? C.green : C.red, fontWeight: 500 }}>{(stats.savingsRate * 100).toFixed(1)}%</span>}
        />
        <Divider />
        <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>场景日均</div>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <tbody>
            {sceneDailyRows.map((r) => {
              const m = tagMeta[r.tagKind];
              return (
                <tr key={r.tagKind}>
                  <td style={{ padding: '5px 0', color: C.sub }}>{m.icon} {m.label}</td>
                  <td style={{ padding: '5px 0', textAlign: 'right', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(r.val)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* 卡片3: FIRE 提前退休 */}
      <Card title="FIRE 提前退休" subtitle="4% 法则">
        {/* 活/生活 胶囊切换 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <div style={{ display: 'flex', backgroundColor: '#e8eaed', borderRadius: 20, padding: 3, gap: 2 }}>
            {(['life', 'all'] as const).map((mode) => {
              const active = fireMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => setFireMode(mode)}
                  style={{
                    padding: '4px 14px', borderRadius: 16, border: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: 600,
                    backgroundColor: active ? '#fff' : 'transparent',
                    color: active ? C.blue : C.sub,
                    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.15)' : 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  {mode === 'life' ? '活' : '生活'}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.sub, marginBottom: 6 }}>
            <span>进度</span>
            <span style={{ fontWeight: 600, color: C.blue }}>{(fire.progress * 100).toFixed(2)}%</span>
          </div>
          <div style={{ height: 10, backgroundColor: '#e8eaed', borderRadius: 5, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(fire.progress * 100, 100)}%`, backgroundColor: C.blue, borderRadius: 5, transition: 'width 0.3s' }} />
          </div>
        </div>
        <StatRow label="目标资产" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmt万(fire.fireTarget)}</span>} />
        <StatRow label="理财总额" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: C.blue }}>{fmt万(totalInvest)}</span>} />
        <StatRow label="月需存入" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: C.orange }}>{fmt万(fire.monthlyNeeded)}</span>} />
        <StatRow label="当前月结余" value={<span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: fire.monthlySurplus >= 0 ? C.green : C.red }}>{fmt万(fire.monthlySurplus)}</span>} />
      </Card>

      {/* 账户余额只读（在对账页编辑） */}
      <Card title="账户余额" subtitle="在对账页编辑">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {accountOrder.map((key) => {
            const r = ACCT_META[key];
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: r.bg, borderRadius: 12, padding: '10px 14px', border: `1.5px solid ${r.border}` }}>
                <span style={{ fontSize: 14, color: '#202124', fontWeight: 500 }}>{r.icon} {r.name}</span>
                <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#202124' }}>¥{formatCurrency(current.accounts[key])}</span>
              </div>
            );
          })}
        </div>
        {showPayWarning && (
          <div style={{ marginTop: 12, fontSize: 13, color: '#c5221f', backgroundColor: '#fce8e6', border: '1px solid #f28b82', borderRadius: 12, padding: '10px 14px' }}>
            ⚠️ 信用卡 {config.creditPayDate} 号还款，剩余 {config.creditPayDate - d} 天
          </div>
        )}
      </Card>

      {/* 固定收入 */}
      <Card title="收入管理" subtitle="支持固定月收入和按天计薪两种模式">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {localIncome.map((item) => {
            const isDailyMode = item.dailyRate !== undefined;
            const effectiveAmt = getEffectiveAmount(item);
            const daysToNext = item.payDay >= d ? item.payDay - d : (daysInMonth - d + item.payDay);
            const isPending = daysToNext <= 3;
            const internCount = tagCountThisMonth['intern'];
            return (
              <div key={item.id} style={{ backgroundColor: isPending ? '#e6f4ea' : '#f8f9fa', borderRadius: 12, padding: '10px 12px', border: `1.5px solid ${isPending ? '#81c995' : '#e0e0e0'}` }}>
                {/* 第一行：启用 + 名称 + 模式切换 + 删除 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <button
                    onClick={() => syncIncome(localIncome.map((x) => x.id === item.id ? { ...x, isActive: !x.isActive } : x))}
                    style={{ flexShrink: 0, width: 18, height: 18, borderRadius: '50%', border: `2px solid ${item.isActive ? C.green : '#dadce0'}`, backgroundColor: item.isActive ? C.green : '#fff', cursor: 'pointer' }}
                  />
                  <input
                    value={item.name}
                    onChange={(e) => updateIncomeField(item.id, 'name', e.target.value)}
                    style={{ flex: 1, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, color: item.isActive ? '#202124' : '#9aa0a6', minWidth: 0 }}
                  />
                  <button
                    onClick={() => toggleDailyRate(item.id)}
                    style={{ flexShrink: 0, fontSize: 11, padding: '2px 8px', borderRadius: 6, border: `1px solid ${isDailyMode ? C.orange : '#dadce0'}`, backgroundColor: isDailyMode ? '#fff4e8' : '#f1f3f4', color: isDailyMode ? C.orange : C.sub, cursor: 'pointer', fontWeight: 600 }}
                  >
                    {isDailyMode ? '日薪' : '固定'}
                  </button>
                  <button onClick={() => removeIncomeItem(item.id)} style={{ flexShrink: 0, background: 'none', border: 'none', color: '#dadce0', fontSize: 16, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>×</button>
                </div>
                {/* 第二行：金额信息 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: C.sub }}>每月</span>
                  <input
                    type="number" inputMode="numeric"
                    value={item.payDay}
                    onChange={(e) => updateIncomeField(item.id, 'payDay', e.target.value)}
                    style={{ width: 28, border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, color: C.blue, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
                  />
                  <span style={{ fontSize: 11, color: C.sub }}>号发薪</span>
                  <span style={{ flex: 1 }} />
                  {isDailyMode ? (
                    <>
                      <span style={{ fontSize: 11, color: C.sub }}>¥</span>
                      <input
                        type="number" inputMode="decimal"
                        value={item.dailyRate ?? 0}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => { const v = e.target.value; updateIncomeField(item.id, 'dailyRate', /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v); }}
                        style={{ width: 60, border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, color: C.orange, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                      />
                      <span style={{ fontSize: 11, color: C.sub }}>/天 × {internCount}天</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.green, fontVariantNumeric: 'tabular-nums' }}>= ¥{formatCurrency(effectiveAmt)}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 11, color: C.sub }}>¥</span>
                      <input
                        type="number" inputMode="decimal"
                        value={item.amount}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => { const v = e.target.value; updateIncomeField(item.id, 'amount', /^-?0\d/.test(v) ? (v.replace(/^(-?)0+/, '$1') || '0') : v); }}
                        style={{ width: 80, border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: C.green, textAlign: 'right' }}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {/* 发薪日提醒 */}
        {localIncome.filter((i) => i.isActive).map((item) => {
          const daysToNext = item.payDay >= d ? item.payDay - d : (daysInMonth - d + item.payDay);
          if (daysToNext > 3) return null;
          const amt = getEffectiveAmount(item);
          return (
            <div key={item.id} style={{ marginTop: 8, fontSize: 13, color: '#0d9488', backgroundColor: '#e6f4ea', border: '1px solid #81c995', borderRadius: 10, padding: '8px 12px' }}>
              💰 {item.name} {daysToNext === 0 ? '今天发薪' : `还有 ${daysToNext} 天发薪`}（每月 {item.payDay} 号，¥{formatCurrency(amt)}）
            </div>
          );
        })}
        <button
          onClick={addIncomeItem}
          style={{ width: '100%', marginTop: 10, padding: '8px 0', fontSize: 13, color: C.blue, backgroundColor: '#e8f0fe', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 600 }}
        >
          + 添加收入项
        </button>
      </Card>
    </div>
  );
}
