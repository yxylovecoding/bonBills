import { describe, expect, it } from 'vitest';
import { markedTaskMinutes } from './taskDuration';

describe('任务标注时长', () => {
  it.each([['阅读(30m)', 30], ['学习（１．５ｈ）', 90], ['运动(1h15m)', 75], ['看剧📺15m', 15], ['会议 1.5小时', 90], ['短任务(0.5m)', 0.5]])('%s 使用 %i 分钟', (title, minutes) => {
    expect(markedTaskMinutes({ title })).toBe(minutes);
  });
  it('描述优先于标题和标签；没有描述标注时使用后续来源', () => {
    expect(markedTaskMinutes({ title: '任务(1h)', content: '总计(30m)\n步骤(5m)', desc: '(2h)', tags: ['(3h)'] })).toBe(30);
    expect(markedTaskMinutes({ title: '任务(1h)', content: '说明', desc: '(2h)' })).toBe(120);
    expect(markedTaskMinutes({ title: '任务', tags: ['活', '(45m)'] })).toBe(45);
  });
  it.each(['任务', '(-1m)', '(0m)', '(1..5h)', '(1h1m左右)', '任务 -10m'])('不从无效标注 %s 编造时长', title => {
    expect(markedTaskMinutes({ title })).toBeNull();
  });
});
