import { useState, type ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BODY_FIELDS, CIRCUMFERENCE_FIELDS, entrySummary, type BodyMetric, type LifeEntries } from '../utils/bonLife';
import { bodyDateLabel, bodySeries, type BodyPoint } from '../utils/lifeBody';

const EMPTY_ENTRIES: LifeEntries = {};

function BodyChart({ metric, points, loading, control }: { metric: BodyMetric; points: BodyPoint[]; loading: boolean; control?: ReactNode }) {
  const { label, unit } = BODY_FIELDS[metric];
  const latest = points.at(-1);
  const ticks = points.filter((_, index) => index === 0 || index === points.length - 1 || index % Math.ceil((points.length - 1) / 3) === 0).map((point) => point.time);
  const domain: [number, number] = points.length > 1 ? [points[0].time, latest!.time]
    : latest ? [latest.time - 86400000, latest.time + 86400000] : [0, 1];

  return <section className="life-body-chart" aria-label={`${label}曲线`}>
    <div className="life-body-chart-heading"><h3>{control ? '体围' : label}</h3>{control}
      <span>{latest ? bodyDateLabel(latest.time) : ''}</span></div>
    <div className="life-body-value">{loading ? '—' : latest?.value ?? '—'}{unit && <span>{unit}</span>}</div>
    {loading || !latest ? <div className="life-body-chart-empty" role="status">{loading ? '读取中…' : '暂无记录'}</div>
      : <div className="life-body-plot"><ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="#e7e6e1" strokeDasharray="3 4" />
          <XAxis dataKey="time" type="number" scale="time" domain={domain} ticks={ticks} tickFormatter={bodyDateLabel}
            axisLine={false} tickLine={false} tick={{ fill: '#83847e', fontSize: 10 }} minTickGap={22} height={24} />
          <YAxis domain={['auto', 'auto']} width={38} tickCount={3} tickFormatter={(value: number) => String(Math.round(value * 100) / 100)}
            axisLine={false} tickLine={false} tick={{ fill: '#83847e', fontSize: 10 }} />
          <Tooltip labelFormatter={(value) => new Date(Number(value)).toISOString().slice(0, 10)}
            formatter={(value) => [`${value}${unit ? ` ${unit}` : ''}`, label]}
            contentStyle={{ border: '1px solid #e7e6e1', borderRadius: 8, fontSize: 12 }}
            cursor={{ stroke: '#c4cabf' }} />
          <Line dataKey="value" name={label} type="linear" stroke="#75876c" strokeWidth={2}
            dot={{ r: 3, fill: '#75876c', strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer></div>}
  </section>;
}

export default function LifeBodyTrends({ year, month, entries = EMPTY_ENTRIES, loading, onPeriodChange, onEdit }: {
  year: number; month: number; entries?: LifeEntries; loading: boolean;
  onPeriodChange: (period: { year: number; month: number }) => void;
  onEdit: (date: string) => void;
}) {
  const [scope, setScope] = useState<'month' | 'year'>('year');
  const [circumference, setCircumference] = useState<typeof CIRCUMFERENCE_FIELDS[number]>('waist');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const defaultDate = today.startsWith(`${year}-`) ? today : `${year}-${String(month).padStart(2, '0')}-01`;
  const prefix = scope === 'month' ? `body:${year}-${String(month).padStart(2, '0')}-` : `body:${year}-`;
  const records = Object.entries(entries).filter(([key, entry]) => key.startsWith(prefix) && entrySummary('body', entry))
    .sort(([a], [b]) => b.localeCompare(a));
  return <>
    <section className="life-body-trends" aria-label="身体趋势" aria-busy={loading}>
    <div className="life-body-toolbar"><h2>身体趋势</h2>
      <div className="life-body-filters">
        <select aria-label="数据年份" value={year} onChange={(event) => onPeriodChange({ year: Number(event.target.value), month })}>
          {Array.from({ length: 301 }, (_, i) => 2200 - i).map((value) => <option key={value} value={value}>{value} 年</option>)}
        </select>
        {scope === 'month' && <select aria-label="数据月份" value={month} onChange={(event) => onPeriodChange({ year, month: Number(event.target.value) })}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((value) => <option key={value} value={value}>{value} 月</option>)}
        </select>}
      <div className="life-body-scope" aria-label="曲线范围">{(['month', 'year'] as const).map((value) =>
        <button key={value} aria-pressed={scope === value} onClick={() => setScope(value)}>{value === 'month' ? '按月' : '全年'}</button>)}</div>
      </div>
    </div>
    <div className="life-body-charts">{(['weight', 'bmi', 'bodyFat', circumference] as const).map((metric) =>
      <BodyChart key={metric} metric={metric} loading={loading} points={bodySeries(entries, metric, year, scope === 'month' ? month : undefined)}
        control={metric === circumference ? <select aria-label="体围指标" value={circumference}
          onChange={(event) => setCircumference(event.target.value as typeof circumference)}>
          {CIRCUMFERENCE_FIELDS.map((field) => <option key={field} value={field}>{BODY_FIELDS[field].label}</option>)}
        </select> : undefined} />)}</div>
    </section>
    <section className="life-body-history" aria-label="身体数据记录" aria-busy={loading}>
      <div className="life-body-toolbar"><h2>记录</h2><form className="life-body-record-actions" onSubmit={(event) => {
        event.preventDefault();
        if (!loading) onEdit(String(new FormData(event.currentTarget).get('date')));
      }}>
        <input key={year} name="date" aria-label="记录日期" type="date" required defaultValue={defaultDate} min={`${year}-01-01`} max={`${year}-12-31`} />
        <button type="submit" className="life-primary" disabled={loading}>记录数据</button>
      </form></div>
      {loading ? <p className="life-empty-state" role="status">读取中…</p> : records.length ? <ul className="life-body-records">{records.map(([key, entry]) => {
        const date = key.slice(5);
        return <li key={key}><button aria-label={`编辑 ${date} 身体数据`} onClick={() => onEdit(date)}>
          <time dateTime={date}>{date.replace(/-/g, '.')}</time><span>{entrySummary('body', entry)}</span><span aria-hidden="true">›</span>
        </button></li>;
      })}</ul> : <p className="life-empty-state">暂无记录</p>}
    </section>
  </>;
}
