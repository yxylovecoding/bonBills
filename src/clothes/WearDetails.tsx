import { feelingEntries } from './feelings';
import type { WearRecord } from './types';
import OutfitWarmth from './OutfitWarmth';

export default function WearDetails({ record }: { record: WearRecord }) {
  const { context, weather } = record;
  const actualWeather = context.manualWeather;
  return <div className="clothes-record-details">
    <p className="clothes-muted">{[context.location?.name, context.scene, context.active ? '运动／多走路' : context.active === false ? '日常活动' : null,
      context.indoorTemperature != null ? `室内 ${context.indoorTemperature}℃` : null,
      actualWeather ? `室外 ${actualWeather.temperature}℃ · ${actualWeather.rain ? '有雨' : '无雨'}` : weather ? `室外 ${weather.temperature}℃ · ${weather.min}–${weather.max}℃ · ${weather.precipitation > 0 ? '有雨' : '无雨'}` : null].filter(Boolean).join(' · ')}</p>
    {record.kind !== 'styled' && record.indoorTemperature !== undefined && <p className="clothes-muted">室内：{record.indoor ?? '未记录'}{record.indoorTemperature != null && `（${record.indoorTemperature}℃）`}</p>}
    {record.kind !== 'styled' && (feelingEntries(record).length ? feelingEntries(record).map((entry) => <p className="clothes-muted" key={entry.period}>
      {entry.period}{entry.indoor && <> · 室内：{entry.indoor}{entry.indoorTemperature != null && `（${entry.indoorTemperature}℃）`}</>}
      {record.purpose !== '睡觉' && <> · 室外：{entry.outdoor ?? '未记录'}{entry.outdoorTemperature != null && `（${entry.outdoorTemperature}℃）`} · 骑车：{entry.cycling ?? '未记录'}</>}
    </p>) : record.indoorTemperature === undefined ? <p className="clothes-muted">体感未记录</p> : null)}
    <OutfitWarmth items={record.items} indoorCoat={record.indoorCoat} indoorOnly={record.purpose === '睡觉'} />
  </div>;
}
