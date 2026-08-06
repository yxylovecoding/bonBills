import { useMemo, useState } from 'react';
import AmountInput from '../components/AmountInput';
import Card from '../components/Card';
import { formatCurrency } from '../components/CurrencyDisplay';
import { calcHistoryStats } from '../calculations/history';
import { useBillDetailStore } from '../stores/billDetailStore';
import { useCalendarStore } from '../stores/calendarStore';
import { useConfigStore } from '../stores/configStore';
import { useExpenseScopeOverrideStore } from '../stores/expenseScopeOverrideStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { useSnapshotStore } from '../stores/snapshotStore';
import { useTripStore } from '../stores/tripStore';
import type { WishItem } from '../models/types';
import { calculateWishPlan, FLEXIBLE_WISH_SHARE, POST_LIFE_FLEXIBLE_SHARE, POST_LIFE_WISH_SHARE } from '../utils/wishes';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', purple: '#7c3aed', sub: '#5f6368', orange: '#e8710a' };

function sanitizeAmount(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function offsetYearMonth(date: Date, offset: number): string {
  const target = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(value: string, currentYearMonth: string): string {
  const [year, month] = value.split('-').map(Number);
  return value === currentYearMonth ? `${month}月 · 本月余` : `${year}年${month}月`;
}

export default function WishesPage() {
  const { config, setConfig } = useConfigStore();
  const { current } = useSnapshotStore();
  const { records } = useMonthlyStore();
  const { tagMap, confirmedExpenses } = useCalendarStore();
  const { expenseItems } = useBillDetailStore();
  const { overrides } = useExpenseScopeOverrideStore();
  const { tripTags } = useTripStore();
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [showAllForecast, setShowAllForecast] = useState(false);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const currentYearMonth = todayKey.slice(0, 7);
  const twoYearsAgo = `${today.getFullYear() - 1}-01`;
  const wishes = config.wishes ?? [];

  const filteredRecords = useMemo(
    () => records.filter((record) => record.yearMonth >= twoYearsAgo),
    [records, twoYearsAgo],
  );
  const stats = useMemo(
    () => calcHistoryStats(filteredRecords, tagMap, confirmedExpenses, expenseItems, overrides, tripTags),
    [filteredRecords, tagMap, confirmedExpenses, expenseItems, overrides, tripTags],
  );
  const savingsReserved = Math.max(current.accounts.savingsCard ?? 0, 0);
  const currentCreditDue = Math.max((current.accounts.creditMonthly ?? 0) - savingsReserved, 0);
  const nextCreditDue = Math.max(
    (current.accounts.credit ?? 0) - Math.max(savingsReserved, current.accounts.creditMonthly ?? 0),
    0,
  );
  const configuredPayDay = Math.min(Math.max(Math.round(config.creditPayDate || 1), 1), 31);
  const daysThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const currentDueOffset = today.getDate() <= Math.min(configuredPayDay, daysThisMonth) ? 0 : 1;
  const currentDueMonth = offsetYearMonth(today, currentDueOffset);
  const nextDueMonth = offsetYearMonth(today, currentDueOffset + 1);
  const repaymentsByMonth = useMemo(() => ({
    [currentDueMonth]: currentCreditDue,
    [nextDueMonth]: nextCreditDue,
  }), [currentCreditDue, currentDueMonth, nextCreditDue, nextDueMonth]);
  const plan = useMemo(
    () => calculateWishPlan(wishes, {
      today,
      tagMap,
      stateDailyAvg: stats.stateDailyAvg,
      repaymentsByMonth,
    }),
    // todayKey 每日变化一次，避免 Date 实例导致无意义的重复计算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wishes, tagMap, stats.stateDailyAvg, repaymentsByMonth, todayKey],
  );
  const registeredSavings = wishes.reduce((sum, item) => sum + Math.max(item.savedAmount, 0), 0);
  const wishJarBalance = Math.max(current.accounts.wishJar ?? 0, 0);
  const totalTaggedDays = plan.months.reduce((sum, month) => sum + month.taggedDays, 0);
  const totalAvailableDays = plan.months.reduce((sum, month) => sum + month.availableDays, 0);
  const incompleteCalendarMonths = plan.months.filter((month) => month.taggedDays < month.availableDays);
  const visibleForecastMonths = showAllForecast ? plan.months : plan.months.slice(0, 12);

  const syncWishes = (items: WishItem[]) => setConfig({ wishes: items });
  const addWish = () => syncWishes([
    ...wishes,
    {
      id: `wish_${Date.now()}`,
      name: '新心愿',
      targetAmount: 0,
      savedAmount: 0,
      deadline: null,
      isActive: true,
    },
  ]);
  const removeWish = (id: string) => syncWishes(wishes.filter((item) => item.id !== id));
  const updateWish = <K extends keyof WishItem>(id: string, field: K, value: WishItem[K]) => {
    syncWishes(wishes.map((item) => item.id === id ? { ...item, [field]: value } : item));
  };
  const updateAmount = (id: string, field: 'targetAmount' | 'savedAmount', raw: string) => {
    const key = `${id}:${field}`;
    setAmountDrafts((prev) => ({ ...prev, [key]: raw }));
    updateWish(id, field, sanitizeAmount(raw));
  };
  const finishAmountEdit = (id: string, field: 'targetAmount' | 'savedAmount') => {
    const key = `${id}:${field}`;
    setAmountDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 2px' }}>心愿</h1>
          <p style={{ fontSize: 13, color: C.sub, margin: 0 }}>把想要的，变成每个月做得到的</p>
        </div>
        <button
          type="button"
          onClick={addWish}
          style={{ border: 'none', borderRadius: 999, backgroundColor: C.purple, color: '#fff', fontSize: 12, fontWeight: 700, padding: '7px 12px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(124,58,237,0.24)' }}
        >
          + 添加心愿
        </button>
      </div>

      <section style={{ background: 'linear-gradient(145deg, #6d28d9 0%, #8b5cf6 58%, #a78bfa 100%)', color: '#fff', borderRadius: 18, padding: '20px', marginBottom: 12, boxShadow: '0 8px 24px rgba(109,40,217,0.2)' }}>
        {plan.activeDeadlineCount > 0 ? (
          <>
            <div style={{ fontSize: 12, opacity: 0.82, marginBottom: 5 }}>从本月起 · 平均每月需赚</div>
            <div style={{ fontSize: 30, lineHeight: 1.15, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>
              ¥{formatCurrency(plan.averageRequiredMonthlyNetIncome)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 16 }}>
              <div style={{ borderRadius: 12, padding: '9px 10px', backgroundColor: 'rgba(255,255,255,0.14)' }}>
                <div style={{ fontSize: 10, opacity: 0.76 }}>预测区间</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{plan.months.length} 个月</div>
              </div>
              <div style={{ borderRadius: 12, padding: '9px 10px', backgroundColor: 'rgba(255,255,255,0.14)' }}>
                <div style={{ fontSize: 10, opacity: 0.76 }}>平均每月攒心愿</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>¥{formatCurrency(plan.averageMonthlyWishAmount)}</div>
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.5, color: incompleteCalendarMonths.length > 0 ? '#fde68a' : '#dcfce7' }}>
              日历已标记 {totalTaggedDays}/{totalAvailableDays} 天
              {incompleteCalendarMonths.length > 0 ? ` · ${incompleteCalendarMonths.length} 个月仍有空白日期` : ' · 已完整计入生活安排'}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 5 }}>给心愿一个截止日期</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, opacity: 0.82 }}>填入目标、已攒金额和 DDL，就会自动算出接下来每月要攒、要赚多少。</div>
          </>
        )}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.2)', marginTop: 14, paddingTop: 11, fontSize: 11, lineHeight: 1.55, opacity: 0.84 }}>
          收入先抵当月日历生活和还款；余额的 {POST_LIFE_FLEXIBLE_SHARE * 100}% 给消费＋心愿，其中 {FLEXIBLE_WISH_SHARE * 100}% 给心愿，所以每多攒 ¥1 心愿需多赚 ¥{(1 / POST_LIFE_WISH_SHARE).toFixed(1)}。
        </div>
      </section>

      <Card title="计算口径" subtitle="日历逐月计算" collapsible defaultCollapsed>
        <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.65 }}>
          <div style={{ display: 'flex', gap: 8, padding: '4px 0' }}><span>①</span><span>从今天起，按日历每天的工作、在校、居家、旅行标记乘以对应生活日均。</span></div>
          <div style={{ display: 'flex', gap: 8, padding: '4px 0' }}><span>②</span><span>计入当前对账已知的本期和下期还款，储蓄卡已预留金额优先抵扣。</span></div>
          <div style={{ display: 'flex', gap: 8, padding: '4px 0' }}><span>③</span><span>每个心愿的剩余金额，从本月到 DDL 月平均分摊。</span></div>
        </div>
        <div style={{ borderTop: '1px solid #f1f3f4', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: C.sub }}>心愿实际分配率</span>
          <span style={{ color: C.purple, fontWeight: 700 }}>50% × 80% = 40%</span>
        </div>
        {(currentCreditDue > 0 || nextCreditDue > 0) && (
          <div style={{ marginTop: 8, fontSize: 11, color: C.sub, backgroundColor: '#f8f9fa', borderRadius: 9, padding: '7px 9px', lineHeight: 1.55 }}>
            已知还款：{currentDueMonth} ¥{formatCurrency(currentCreditDue)}
            {nextCreditDue > 0 ? ` · ${nextDueMonth} ¥${formatCurrency(nextCreditDue)}` : ''}
          </div>
        )}
      </Card>

      {plan.months.length > 0 && (
        <Card title="逐月收入目标" subtitle="生活＋还款＋心愿">
          {incompleteCalendarMonths.length > 0 && (
            <div style={{ color: C.orange, backgroundColor: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, fontSize: 11, lineHeight: 1.5, padding: '7px 9px', marginBottom: 10 }}>
              未标记的日期暂不计生活费；继续在日历补齐安排后，这里的金额会自动更新。
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {visibleForecastMonths.map((month, index) => {
              const incomplete = month.taggedDays < month.availableDays;
              return (
                <div key={month.yearMonth} style={{ padding: '10px 0', borderTop: index > 0 ? '1px solid #f1f3f4' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{monthLabel(month.yearMonth, currentYearMonth)}</span>
                    <span style={{ fontSize: 15, fontWeight: 800, color: C.purple, fontVariantNumeric: 'tabular-nums' }}>¥{formatCurrency(month.requiredNetIncome)}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 9px', marginTop: 4, fontSize: 10, color: C.sub, lineHeight: 1.45 }}>
                    <span>生活 ¥{formatCurrency(month.lifeExpense)}</span>
                    {month.repayment > 0 && <span>还款 ¥{formatCurrency(month.repayment)}</span>}
                    <span>心愿 ¥{formatCurrency(month.wishAmount)}</span>
                    <span style={{ color: incomplete ? C.orange : C.green }}>日历 {month.taggedDays}/{month.availableDays} 天</span>
                  </div>
                </div>
              );
            })}
          </div>
          {plan.months.length > 12 && (
            <button
              type="button"
              onClick={() => setShowAllForecast((value) => !value)}
              style={{ width: '100%', border: 'none', borderRadius: 10, backgroundColor: '#f5f3ff', color: C.purple, fontSize: 11, fontWeight: 700, padding: '8px 10px', cursor: 'pointer', marginTop: 4 }}
            >
              {showAllForecast ? '收起远期月份' : `查看全部 ${plan.months.length} 个月`}
            </button>
          )}
          <div style={{ marginTop: 9, fontSize: 10, color: '#9aa0a6', lineHeight: 1.5 }}>
            还款仅展示当前对账已经知道的本期与下期，后续月份会随新账单自动更新。
          </div>
        </Card>
      )}

      <Card title="心愿清单" subtitle={`${wishes.length} 个心愿`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '0 0 12px', marginBottom: 12, borderBottom: '1px solid #f1f3f4', fontSize: 11 }}>
          <span style={{ color: C.sub }}>心愿罐 ¥{formatCurrency(wishJarBalance)}</span>
          <span style={{ color: registeredSavings > wishJarBalance ? C.orange : C.sub }}>已登记 ¥{formatCurrency(registeredSavings)}</span>
        </div>
        {registeredSavings > wishJarBalance && (
          <div style={{ color: C.orange, backgroundColor: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, fontSize: 11, lineHeight: 1.5, padding: '7px 9px', marginBottom: 10 }}>
            各心愿的“已攒”合计高于心愿罐余额，请确认是否包含了罐外资金。
          </div>
        )}
        {wishes.length === 0 && (
          <div style={{ textAlign: 'center', padding: '26px 12px 20px', color: C.sub }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>♡</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#3c4043' }}>还没有心愿</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>先写下一个想实现的目标吧</div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {plan.items.map((item) => {
            const progress = item.targetAmount > 0 ? Math.min(item.savedAmount / item.targetAmount, 1) : 0;
            const targetKey = `${item.id}:targetAmount`;
            const savedKey = `${item.id}:savedAmount`;
            return (
              <div key={item.id} style={{ border: `1px solid ${item.isActive ? '#e9d5ff' : '#e5e7eb'}`, backgroundColor: item.isActive ? '#fdfaff' : '#fafafa', borderRadius: 14, padding: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    aria-label={item.isActive ? '暂停心愿' : '启用心愿'}
                    onClick={() => updateWish(item.id, 'isActive', !item.isActive)}
                    style={{ flexShrink: 0, width: 18, height: 18, borderRadius: '50%', border: `2px solid ${item.isActive ? C.purple : '#d1d5db'}`, backgroundColor: item.isActive ? C.purple : '#fff', cursor: 'pointer', boxShadow: item.isActive ? 'inset 0 0 0 3px #fff' : 'none' }}
                  />
                  <input
                    aria-label="心愿名称"
                    value={item.name}
                    onChange={(event) => updateWish(item.id, 'name', event.target.value)}
                    style={{ flex: 1, minWidth: 0, border: 'none', borderBottom: '1px solid transparent', outline: 'none', background: 'transparent', fontSize: 14, fontWeight: 700, color: item.isActive ? '#202124' : '#9aa0a6' }}
                  />
                  <button type="button" aria-label="删除心愿" onClick={() => removeWish(item.id)} style={{ border: 'none', background: 'transparent', color: '#9aa0a6', fontSize: 18, padding: '0 2px', cursor: 'pointer', lineHeight: 1 }}>×</button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginTop: 12 }}>
                  <label style={{ display: 'block' }}>
                    <span style={{ display: 'block', fontSize: 10, color: C.sub, marginBottom: 4 }}>目标金额</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid #e5e7eb', borderRadius: 9, backgroundColor: '#fff', padding: '6px 8px' }}>
                      <span style={{ fontSize: 11, color: C.sub }}>¥</span>
                      <AmountInput
                        aria-label="目标金额"
                        value={amountDrafts[targetKey] ?? (item.targetAmount ? String(item.targetAmount) : '')}
                        onChange={(raw) => updateAmount(item.id, 'targetAmount', raw)}
                        onBlur={() => finishAmountEdit(item.id, 'targetAmount')}
                        placeholder="0"
                        style={{ width: '100%', minWidth: 0, border: 'none', outline: 'none', background: 'transparent', textAlign: 'right', fontSize: 12, fontWeight: 700, color: C.purple }}
                      />
                    </div>
                  </label>
                  <label style={{ display: 'block' }}>
                    <span style={{ display: 'block', fontSize: 10, color: C.sub, marginBottom: 4 }}>已经攒下</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid #e5e7eb', borderRadius: 9, backgroundColor: '#fff', padding: '6px 8px' }}>
                      <span style={{ fontSize: 11, color: C.sub }}>¥</span>
                      <AmountInput
                        aria-label="已攒金额"
                        value={amountDrafts[savedKey] ?? (item.savedAmount ? String(item.savedAmount) : '')}
                        onChange={(raw) => updateAmount(item.id, 'savedAmount', raw)}
                        onBlur={() => finishAmountEdit(item.id, 'savedAmount')}
                        placeholder="0"
                        style={{ width: '100%', minWidth: 0, border: 'none', outline: 'none', background: 'transparent', textAlign: 'right', fontSize: 12, fontWeight: 700, color: C.green }}
                      />
                    </div>
                  </label>
                </div>

                <label style={{ display: 'block', marginTop: 9 }}>
                  <span style={{ display: 'block', fontSize: 10, color: C.sub, marginBottom: 4 }}>截止日期（可选）</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="date"
                      aria-label="心愿截止日期"
                      value={item.deadline ?? ''}
                      onChange={(event) => updateWish(item.id, 'deadline', event.target.value || null)}
                      style={{ flex: 1, minWidth: 0, border: '1px solid #e5e7eb', borderRadius: 9, backgroundColor: '#fff', padding: '6px 8px', outline: 'none', fontSize: 12, color: item.deadline ? '#202124' : C.sub }}
                    />
                    {item.deadline && (
                      <button type="button" onClick={() => updateWish(item.id, 'deadline', null)} style={{ border: 'none', borderRadius: 8, padding: '7px 9px', backgroundColor: '#f3f4f6', color: C.sub, fontSize: 11, cursor: 'pointer' }}>清除</button>
                    )}
                  </div>
                </label>

                <div style={{ height: 6, borderRadius: 999, backgroundColor: '#ede9fe', overflow: 'hidden', marginTop: 12 }}>
                  <div style={{ width: `${progress * 100}%`, height: '100%', borderRadius: 999, backgroundColor: progress >= 1 ? C.green : C.purple, transition: 'width 0.2s' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 6, fontSize: 10, color: C.sub }}>
                  <span>{item.targetAmount > 0 ? `完成 ${(progress * 100).toFixed(0)}%` : '等待填写目标'}</span>
                  {item.targetAmount > 0 && <span>还差 ¥{formatCurrency(item.remainingAmount)}</span>}
                </div>

                <div style={{ marginTop: 10, borderRadius: 10, padding: '8px 9px', backgroundColor: item.deadlineState === 'overdue' ? '#fef2f2' : item.deadlineState === 'completed' ? '#ecfdf5' : '#f5f3ff', color: item.deadlineState === 'overdue' ? C.red : item.deadlineState === 'completed' ? C.green : C.purple, fontSize: 11, fontWeight: 700, lineHeight: 1.5 }}>
                  {!item.isActive && '已暂停，不计入月收入目标'}
                  {item.isActive && item.deadlineState === 'completed' && '✓ 心愿已经攒满'}
                  {item.isActive && item.deadlineState === 'none' && (item.remainingAmount > 0 ? '无 DDL，按自己的节奏慢慢攒' : '填入目标金额后开始计算')}
                  {item.isActive && item.deadlineState === 'overdue' && `已超期 · 本月需补 ¥${formatCurrency(item.monthlyWishAmount)}`}
                  {item.isActive && item.deadlineState === 'scheduled' && item.remainingAmount > 0 && (
                    `还剩 ${item.monthsRemaining} 个月 · 每月攒 ¥${formatCurrency(item.monthlyWishAmount)}`
                  )}
                  {item.isActive && item.deadlineState === 'scheduled' && item.targetAmount <= 0 && '填入目标金额后开始计算'}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
