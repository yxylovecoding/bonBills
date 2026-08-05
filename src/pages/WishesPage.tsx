import { useMemo, useState } from 'react';
import AmountInput from '../components/AmountInput';
import Card from '../components/Card';
import CurrencyDisplay, { formatCurrency } from '../components/CurrencyDisplay';
import { calcHistoryStats } from '../calculations/history';
import { useBillDetailStore } from '../stores/billDetailStore';
import { useCalendarStore } from '../stores/calendarStore';
import { useConfigStore } from '../stores/configStore';
import { useExpenseScopeOverrideStore } from '../stores/expenseScopeOverrideStore';
import { useMonthlyStore } from '../stores/monthlyStore';
import { useSnapshotStore } from '../stores/snapshotStore';
import { useTripStore } from '../stores/tripStore';
import type { TagKind, WishItem } from '../models/types';
import { calculateWishPlan, FLEXIBLE_WISH_SHARE, POST_LIFE_FLEXIBLE_SHARE, POST_LIFE_WISH_SHARE } from '../utils/wishes';

const C = { blue: '#1a73e8', red: '#ea4335', green: '#0d9488', purple: '#7c3aed', sub: '#5f6368', orange: '#e8710a' };
const SCENE_LABELS: Record<TagKind, string> = { intern: '工作', school: '在校', home: '居家', travel: '旅行' };

function sanitizeAmount(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
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
  const today = new Date();
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
  const configuredScene = config.fireExpenseTagKind ?? 'intern';
  const sceneHasData = stats.stateDailyConfidence[configuredScene] > 0;
  const activeFutureMonthly = (config.futureFireExpenses ?? [])
    .filter((item) => item.isActive)
    .reduce((sum, item) => sum + Math.max(item.monthlyAmount, 0), 0);
  const baseMonthlyLifeExpense = sceneHasData
    ? stats.stateDailyAvg[configuredScene] * 365 / 12
    : stats.totalLife;
  const monthlyLifeExpense = baseMonthlyLifeExpense + activeFutureMonthly;
  const plan = useMemo(
    () => calculateWishPlan(wishes, monthlyLifeExpense, today),
    // 日期只需随页面重新进入刷新，避免把 Date 对象作为不稳定依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wishes, monthlyLifeExpense, today.toDateString()],
  );
  const incomeGap = plan.requiredMonthlyNetIncome - stats.monthlyIncomeAvg;
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
        {plan.activeDeadlineCount > 0 ? (
          <>
            <div style={{ fontSize: 12, opacity: 0.82, marginBottom: 5 }}>{plan.activeDeadlineCount} 个 DDL 心愿所需税后月收入</div>
            <div style={{ fontSize: 30, lineHeight: 1.15, fontWeight: 800, fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5 }}>
              ¥{formatCurrency(plan.requiredMonthlyNetIncome)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 16 }}>
              <div style={{ borderRadius: 12, padding: '9px 10px', backgroundColor: 'rgba(255,255,255,0.14)' }}>
                <div style={{ fontSize: 10, opacity: 0.76 }}>每月生活</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>¥{formatCurrency(monthlyLifeExpense)}</div>
              </div>
              <div style={{ borderRadius: 12, padding: '9px 10px', backgroundColor: 'rgba(255,255,255,0.14)' }}>
                <div style={{ fontSize: 10, opacity: 0.76 }}>每月攒心愿</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>¥{formatCurrency(plan.monthlyWishAmount)}</div>
              </div>
            </div>
            {stats.monthlyIncomeAvg > 0 && (
              <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.5, color: incomeGap > 0 ? '#fde68a' : '#dcfce7' }}>
                {incomeGap > 0
                  ? `比历史月均收入还需多赚 ¥${formatCurrency(incomeGap)}`
                  : `历史月均收入可覆盖，余量 ¥${formatCurrency(Math.abs(incomeGap))}`}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 5 }}>给心愿一个截止日期</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, opacity: 0.82 }}>填入目标、已攒金额和 DDL，就会自动算出接下来每月要攒、要赚多少。</div>
          </>
        )}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.2)', marginTop: 14, paddingTop: 11, fontSize: 11, lineHeight: 1.55, opacity: 0.84 }}>
          收入先抵生活；余额的 {POST_LIFE_FLEXIBLE_SHARE * 100}% 给消费＋心愿，其中 {FLEXIBLE_WISH_SHARE * 100}% 给心愿，所以每多攒 ¥1 心愿需多赚 ¥{(1 / POST_LIFE_WISH_SHARE).toFixed(1)}。
        </div>
      </section>

      <Card title="计算口径" subtitle={sceneHasData ? `按${SCENE_LABELS[configuredScene]}场景` : '场景数据不足，按历史月均'} collapsible defaultCollapsed>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <label htmlFor="wish-life-scene" style={{ fontSize: 12, color: C.sub }}>生活场景</label>
          <select
            id="wish-life-scene"
            value={configuredScene}
            onChange={(event) => setConfig({ fireExpenseTagKind: event.target.value as TagKind })}
            style={{ border: '1px solid #e0e0e0', borderRadius: 999, backgroundColor: '#fff', fontSize: 12, fontWeight: 700, padding: '5px 9px', outline: 'none' }}
          >
            {(Object.keys(SCENE_LABELS) as TagKind[]).map((kind) => <option key={kind} value={kind}>{SCENE_LABELS[kind]}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0' }}>
          <span style={{ color: C.sub }}>月生活费</span>
          <CurrencyDisplay value={monthlyLifeExpense} color={C.blue} />
        </div>
        {activeFutureMonthly > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0' }}>
            <span style={{ color: C.sub }}>含 FIRE 未来固定支出</span>
            <span style={{ color: C.orange }}>¥{formatCurrency(activeFutureMonthly)}/月</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '5px 0' }}>
          <span style={{ color: C.sub }}>心愿实际分配率</span>
          <span style={{ color: C.purple, fontWeight: 700 }}>50% × 80% = 40%</span>
        </div>
      </Card>

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
