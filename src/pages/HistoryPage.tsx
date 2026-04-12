import { useMemo, useState } from 'react';
import Card from '../components/Card';
import StatRow from '../components/StatRow';
import CurrencyDisplay from '../components/CurrencyDisplay';
import { monthlyRecords } from '../data/mockData';
import type { MonthlyRecord } from '../models/types';

type ViewTab = 'monthly' | 'yearly';

export default function HistoryPage() {
  const [tab, setTab] = useState<ViewTab>('monthly');

  return (
    <div>
      <h1 className="text-xl font-bold text-gtext mb-3">历史记录</h1>

      {/* Tabs */}
      <div className="flex bg-gray-100 rounded-full p-1 mb-4 text-sm">
        <TabButton active={tab === 'monthly'} onClick={() => setTab('monthly')}>
          月度
        </TabButton>
        <TabButton active={tab === 'yearly'} onClick={() => setTab('yearly')}>
          年度
        </TabButton>
      </div>

      {tab === 'monthly' ? <MonthlyView /> : <YearlyView />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-2 rounded-full font-medium transition-all
                  ${active ? 'bg-white text-gblue shadow-sm' : 'text-gsub'}`}
    >
      {children}
    </button>
  );
}

function MonthlyView() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sorted = useMemo(
    () => [...monthlyRecords].sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : -1)),
    [],
  );

  return (
    <>
      <Card title="月度列表" subtitle={`共 ${sorted.length} 个月`}>
        <div className="-mx-2">
          {sorted.map((r) => (
            <MonthlyRow
              key={r.yearMonth}
              record={r}
              expanded={expanded === r.yearMonth}
              onToggle={() => setExpanded(expanded === r.yearMonth ? null : r.yearMonth)}
            />
          ))}
        </div>
      </Card>

      <Card title="月度趋势" subtitle="Recharts 接入中">
        <div className="h-40 bg-gray-50 rounded-xl flex items-center justify-center text-xs text-gsub">
          📈 收入 vs 支出 vs 结余 趋势图
        </div>
        <div className="h-32 bg-gray-50 rounded-xl mt-2 flex items-center justify-center text-xs text-gsub">
          📊 周期生活 / 波动生活 / 消费 堆叠图
        </div>
      </Card>
    </>
  );
}

function MonthlyRow({
  record,
  expanded,
  onToggle,
}: {
  record: MonthlyRecord;
  expanded: boolean;
  onToggle: () => void;
}) {
  const surplus = record.income - record.totalExpense;
  const savingsRate = record.income > 0 ? surplus / record.income : 0;

  return (
    <div className="border-b border-gborder/50 last:border-none">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-2 py-3 text-left
                   hover:bg-gray-50 rounded-lg transition-colors"
      >
        <div className="flex-1">
          <div className="text-sm font-semibold text-gtext">{record.yearMonth}</div>
          <div className="text-[10px] text-gsub mt-0.5">
            收 <CurrencyDisplay value={record.income} size="sm" className="text-income" />
            {' · '}
            支 <CurrencyDisplay value={record.totalExpense} size="sm" className="text-expense" />
          </div>
        </div>
        <div className="text-right">
          <CurrencyDisplay
            value={surplus}
            size="sm"
            className={surplus >= 0 ? 'text-expense font-semibold' : 'text-income font-semibold'}
          />
          <div className="text-[10px] text-gsub">
            {(savingsRate * 100).toFixed(1)}%
          </div>
        </div>
        <span className="ml-2 text-gsub text-xs">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="bg-gray-50 rounded-xl mx-2 mb-2 p-3">
          <StatRow
            label="周期生活"
            value={<CurrencyDisplay value={record.periodicLife} className="text-life" size="sm" />}
          />
          <StatRow
            label="波动生活"
            value={<CurrencyDisplay value={record.volatileLife} className="text-life" size="sm" />}
          />
          <StatRow
            label="消费"
            value={<CurrencyDisplay value={record.consumption} className="text-consume" size="sm" />}
          />
          <StatRow label="校园卡" value={<CurrencyDisplay value={record.school} size="sm" />} />
          <div className="h-px bg-gborder my-2" />
          <StatRow label="在家" value={`${record.homeDays} 天`} />
          <StatRow label="出差/旅游" value={`${record.travelDays} 天`} />
          {record.investTotal !== undefined && (
            <StatRow label="月末理财" value={<CurrencyDisplay value={record.investTotal} size="sm" />} />
          )}
        </div>
      )}
    </div>
  );
}

function YearlyView() {
  const byYear = useMemo(() => {
    const map: Record<string, MonthlyRecord[]> = {};
    for (const r of monthlyRecords) {
      const y = r.yearMonth.slice(0, 4);
      (map[y] ||= []).push(r);
    }
    return Object.entries(map).sort(([a], [b]) => (a < b ? 1 : -1));
  }, []);

  return (
    <>
      {byYear.map(([year, records]) => {
        const income = records.reduce((s, r) => s + r.income, 0);
        const expense = records.reduce((s, r) => s + r.totalExpense, 0);
        const surplus = income - expense;
        const rate = income > 0 ? surplus / income : 0;
        return (
          <Card key={year} title={`${year} 年`} subtitle={`${records.length} 个月`}>
            <StatRow
              label="总收入"
              value={<CurrencyDisplay value={income} className="text-income" />}
            />
            <StatRow
              label="总支出"
              value={<CurrencyDisplay value={expense} className="text-expense" />}
            />
            <StatRow
              label="总结余"
              value={
                <CurrencyDisplay
                  value={surplus}
                  className={surplus >= 0 ? 'text-expense' : 'text-income'}
                />
              }
            />
            <StatRow
              label="储蓄率"
              value={
                <span className={rate >= 0 ? 'text-expense' : 'text-income'}>
                  {(rate * 100).toFixed(1)}%
                </span>
              }
            />
            <div className="h-px bg-gborder my-2" />
            <StatRow
              label="月均收入"
              value={<CurrencyDisplay value={income / records.length} size="sm" />}
            />
            <StatRow
              label="月均支出"
              value={<CurrencyDisplay value={expense / records.length} size="sm" />}
            />
          </Card>
        );
      })}

      <Card title="支出分类" subtitle="记账数据接入后填充">
        <div className="h-40 bg-gray-50 rounded-xl flex items-center justify-center text-xs text-gsub">
          🥧 饮食 / 生活 / 购物 / 娱乐 / 交通 / 课学 / 人际 / 医疗
        </div>
      </Card>
    </>
  );
}
