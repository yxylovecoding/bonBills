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
import { useHolidayYears } from '../utils/holidays';
import { calculateWishInternPlan } from '../utils/wishInternPlan';
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

function dateInMonth(value: string, requestedDay: number): string {
  const [year, month] = value.split('-').map(Number);
  const day = Math.min(requestedDay, new Date(year, month, 0).getDate());
  return `${value}-${String(day).padStart(2, '0')}`;
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
  const [planningDeadline, setPlanningDeadline] = useState('');
  const today = new Date();
  const todayYear = today.getFullYear();
  const todayKey = `${todayYear}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const twoYearsAgo = `${todayYear - 1}-01`;
  const wishes = config.wishes ?? [];
  const defaultPlanningDeadline = useMemo(
    () => wishes
      .filter((wish) => wish.isActive && wish.deadline && wish.deadline >= todayKey && wish.targetAmount > wish.savedAmount)
      .reduce((latest, wish) => wish.deadline && wish.deadline > latest ? wish.deadline : latest, todayKey),
    [todayKey, wishes],
  );
  const effectivePlanningDeadline = planningDeadline >= todayKey ? planningDeadline : defaultPlanningDeadline;
  const planningEndYear = Math.max(Number(effectivePlanningDeadline.slice(0, 4)) || todayYear, todayYear);
  const holidayYears = useMemo(
    () => Array.from(
      { length: Math.min(planningEndYear - todayYear + 1, 20) },
      (_, index) => todayYear + index,
    ),
    [planningEndYear, todayYear],
  );
  const { holidayDataByYear, holidayLoading, holidayWarning } = useHolidayYears(holidayYears);

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
  const planningRepaymentsByMonth = useMemo(() => {
    const result: Record<string, number> = {};
    const currentDueDate = dateInMonth(currentDueMonth, configuredPayDay);
    const nextDueDate = dateInMonth(nextDueMonth, configuredPayDay);
    if (currentDueDate >= todayKey && currentDueDate <= effectivePlanningDeadline) result[currentDueMonth] = currentCreditDue;
    if (nextDueDate >= todayKey && nextDueDate <= effectivePlanningDeadline) result[nextDueMonth] = nextCreditDue;
    return result;
  }, [configuredPayDay, currentCreditDue, currentDueMonth, effectivePlanningDeadline, nextCreditDue, nextDueMonth, todayKey]);
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
  const internPlan = useMemo(
    () => calculateWishInternPlan({
      today,
      deadline: effectivePlanningDeadline,
      wishes,
      incomeItems: config.incomeItems,
      tagMap,
      stateDailyAvg: stats.stateDailyAvg,
      repaymentsByMonth: planningRepaymentsByMonth,
      holidayDataByYear,
    }),
    // todayKey 每日变化一次，避免 Date 实例导致无意义的重复计算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.incomeItems, effectivePlanningDeadline, holidayDataByYear, planningRepaymentsByMonth, stats.stateDailyAvg, tagMap, todayKey, wishes],
  );
  const registeredSavings = wishes.reduce((sum, item) => sum + Math.max(item.savedAmount, 0), 0);
  const wishJarBalance = Math.max(current.accounts.wishJar ?? 0, 0);

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 10, opacity: 0.72 }}>从今天开始规划</div>
            <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2 }}>{todayKey} 至</div>
          </div>
          <input
            type="date"
            aria-label="心愿规划截止日期"
            min={todayKey}
            value={effectivePlanningDeadline}
            onChange={(event) => setPlanningDeadline(event.target.value)}
            style={{ minWidth: 132, border: '1px solid rgba(255,255,255,0.38)', borderRadius: 9, outline: 'none', backgroundColor: 'rgba(255,255,255,0.16)', color: '#fff', padding: '6px 8px', fontSize: 12, fontWeight: 700, colorScheme: 'dark' }}
          />
        </div>
        {internPlan.wishAmount > 0 ? (
          <>
            <div style={{ fontSize: 12, opacity: 0.82, marginBottom: 5 }}>
              {internPlan.minimumInternDays === null ? '全部工作日实习仍无法按期攒够' : '按期攒够 · 最少需要'}
            </div>
            <div style={{ fontSize: 30, lineHeight: 1.15, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>
              {internPlan.minimumInternDays === null
                ? `还差 ¥${formatCurrency(internPlan.shortfall)}`
                : `${internPlan.minimumInternDays} 个实习日`}
            </div>
            <div style={{ fontSize: 11, opacity: 0.82, marginTop: 6 }}>
              共 {internPlan.availableInternDays} 个截止前可到账的工作日可选，其余时间按上学估算
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
              <div style={{ borderRadius: 12, padding: '9px 10px', backgroundColor: 'rgba(255,255,255,0.14)' }}>
                <div style={{ fontSize: 10, opacity: 0.76 }}>不新增实习可赚</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>¥{formatCurrency(internPlan.minimumIncome)}</div>
              </div>
              <div style={{ borderRadius: 12, padding: '9px 10px', backgroundColor: 'rgba(255,255,255,0.14)' }}>
                <div style={{ fontSize: 10, opacity: 0.76 }}>工作日全实习可赚</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>¥{formatCurrency(internPlan.maximumIncome)}</div>
              </div>
              <div style={{ borderRadius: 12, padding: '9px 10px', backgroundColor: 'rgba(255,255,255,0.14)' }}>
                <div style={{ fontSize: 10, opacity: 0.76 }}>最少方案需赚</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>¥{formatCurrency(internPlan.requiredIncome)}</div>
              </div>
              <div style={{ borderRadius: 12, padding: '9px 10px', backgroundColor: 'rgba(255,255,255,0.14)' }}>
                <div style={{ fontSize: 10, opacity: 0.76 }}>心愿还需攒</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>¥{formatCurrency(internPlan.wishAmount)}</div>
              </div>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.5, color: internPlan.minimumInternDays === null ? '#fde68a' : '#dcfce7' }}>
              {holidayLoading ? '正在校准法定工作日…' : '实习只安排在工作日'}
              {' · '}收入按实际到账日计入
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 5 }}>给心愿一个截止日期</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, opacity: 0.82 }}>填入目标、已攒金额和 DDL，就会自动算出在能攒够的前提下最少需要实习几天。</div>
          </>
        )}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.2)', marginTop: 14, paddingTop: 11, fontSize: 11, lineHeight: 1.55, opacity: 0.84 }}>
          收入先抵当月日历生活和还款；余额的 {POST_LIFE_FLEXIBLE_SHARE * 100}% 给消费＋心愿，其中 {FLEXIBLE_WISH_SHARE * 100}% 给心愿，所以每多攒 ¥1 心愿需多赚 ¥{(1 / POST_LIFE_WISH_SHARE).toFixed(1)}。
        </div>
      </section>

      <Card title="计算口径" subtitle="优先少实习" collapsible defaultCollapsed>
        <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.65 }}>
          <div style={{ display: 'flex', gap: 8, padding: '4px 0' }}><span>①</span><span>居家、旅行安排保持不变；其余日期默认上学，只有法定工作日可以改为实习。</span></div>
          <div style={{ display: 'flex', gap: 8, padding: '4px 0' }}><span>②</span><span>比较不新增实习和工作日全实习的税后到账收入，并计入对应场景生活费与已知还款。</span></div>
          <div style={{ display: 'flex', gap: 8, padding: '4px 0' }}><span>③</span><span>从对攒钱最有效的发薪周期开始安排，刚好达到心愿目标后停止增加实习日。</span></div>
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
        {holidayWarning && (
          <div style={{ marginTop: 8, fontSize: 11, color: C.orange, backgroundColor: '#fff7ed', borderRadius: 9, padding: '7px 9px', lineHeight: 1.55 }}>
            {holidayWarning}
          </div>
        )}
      </Card>

      {internPlan.wishAmount > 0 && (
        <Card title="最少实习安排" subtitle="其余工作日上学">
          {internPlan.minimumInternDays === 0 && (
            <div style={{ color: C.green, backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, fontSize: 12, lineHeight: 1.5, padding: '9px 10px' }}>
              不需要新增实习，按当前固定收入和已有待到账收入即可攒够。
            </div>
          )}
          {internPlan.minimumInternDays === null && (
            <div style={{ color: C.red, backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 12, lineHeight: 1.5, padding: '9px 10px', marginBottom: 8 }}>
              截止前可到账的工作日全部实习仍差 ¥{formatCurrency(internPlan.shortfall)}，需要推迟截止日期、降低目标或增加其他收入。
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {internPlan.months.map((month, index) => (
              <div key={month.yearMonth} style={{ padding: '9px 0', borderTop: index > 0 ? '1px solid #f1f3f4' : 'none', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{month.yearMonth}</span>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: month.internDays > 0 ? C.purple : C.green, fontVariantNumeric: 'tabular-nums' }}>{month.internDays} 天实习</span>
                  <span style={{ display: 'block', fontSize: 10, color: C.sub, marginTop: 2 }}>可选 {month.availableInternDays} 个工作日</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 9, fontSize: 10, color: '#9aa0a6', lineHeight: 1.5 }}>
            实习日优先安排在税后增收更高、且能在截止日前到账的发薪周期；具体日期可在“月”页面标记。
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
                  {!item.isActive && '已暂停，不计入最少实习规划'}
                  {item.isActive && item.deadlineState === 'completed' && '✓ 心愿已经攒满'}
                  {item.isActive && item.deadlineState === 'none' && (item.remainingAmount > 0 ? '无 DDL，按自己的节奏慢慢攒' : '填入目标金额后开始计算')}
                  {item.isActive && item.deadlineState === 'overdue' && `已超期 · 还需补 ¥${formatCurrency(item.remainingAmount)}`}
                  {item.isActive && item.deadlineState === 'scheduled' && item.remainingAmount > 0 && (
                    `还剩 ${item.monthsRemaining} 个月 · 截止前还需攒 ¥${formatCurrency(item.remainingAmount)}`
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
