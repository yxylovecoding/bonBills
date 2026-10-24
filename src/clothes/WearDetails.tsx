import { feelingEntries } from './feelings';
import type { WearRecord } from './types';
import { dailyWeatherLabel, weatherSymbol } from '../utils/weather';
import { cityLabel } from '../utils/sceneCities';

export default function WearDetails({ record }: { record: WearRecord }) {
  const { context, weather } = record;
  const actualWeather = context.manualWeather;
  return <div className="clothes-record-details">
    <p className="clothes-muted" aria-label="当天地点与天气">{[cityLabel(context.location),
      actualWeather ? `${actualWeather.rain ? '🌧️ 有雨' : '无雨'} · ${actualWeather.temperature}℃` : weather ? `${weatherSymbol(weather.code)?.icon ?? ''} ${dailyWeatherLabel(weather)}`.trim() : '天气未记录'].filter(Boolean).join(' · ')}</p>
    <p className="clothes-muted" aria-label="当天场景">{[context.scene ?? '场景未记录', context.active ? '运动／多走路' : context.active === false ? '日常活动' : null].filter(Boolean).join(' · ')}</p>
    {record.kind !== 'styled' && record.indoorTemperature !== undefined && <p className="clothes-muted">室内：{record.indoor ?? '未记录'}{record.indoorTemperature != null && `（${record.indoorTemperature}℃）`}</p>}
    {record.kind !== 'styled' && (feelingEntries(record).length ? feelingEntries(record).map((entry) => <p className="clothes-muted" key={entry.period}>
      {entry.period}{entry.indoor && <> · 室内：{entry.indoor}{entry.indoorTemperature != null && `（${entry.indoorTemperature}℃）`}</>}
      {record.purpose !== '睡觉' && <> · 室外：{entry.outdoor ?? '未记录'}{entry.outdoorTemperature != null && `（${entry.outdoorTemperature}℃）`} · 骑车：{entry.cycling ?? '未记录'}</>}
    </p>) : record.indoorTemperature === undefined ? <p className="clothes-muted">体感未记录</p> : null)}
  </div>;
}
