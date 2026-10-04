import { useState, type ReactNode } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BODY_FIELDS, CIRCUMFERENCE_FIELDS, type BodyMetric, type LifeEntries } from '../utils/bonLife';
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

export default function LifeBodyTrends({ year, month, entries = EMPTY_ENTRIES, loading }: {
  year: number; month: number; entries?: LifeEntries; loading: boolean;
}) {
  const [scope, setScope] = useState<'month' | 'year'>('year');
  const [circumference, setCircumference] = useState<typeof CIRCUMFERENCE_FIELDS[number]>('waist');
  return <section className="life-body-trends" aria-label="身体趋势" aria-busy={loading}>
    <div className="life-body-toolbar"><h2>身体趋势 <span>{year} 年{scope === 'month' ? ` ${month} 月` : ''}</span></h2>
      <div className="life-body-scope" aria-label="曲线范围">{(['month', 'year'] as const).map((value) =>
        <button key={value} aria-pressed={scope === value} onClick={() => setScope(value)}>{value === 'month' ? '本月' : '全年'}</button>)}</div>
    </div>
    <div className="life-body-charts">{(['weight', 'bmi', 'bodyFat', circumference] as const).map((metric) =>
      <BodyChart key={metric} metric={metric} loading={loading} points={bodySeries(entries, metric, year, scope === 'month' ? month : undefined)}
        control={metric === circumference ? <select aria-label="体围指标" value={circumference}
          onChange={(event) => setCircumference(event.target.value as typeof circumference)}>
          {CIRCUMFERENCE_FIELDS.map((field) => <option key={field} value={field}>{BODY_FIELDS[field].label}</option>)}
        </select> : undefined} />)}</div>
  </section>;
}
