import { expect, it } from 'vitest';
import { outlookStatusError } from './_outlookStatus';

it('已知错误给出具体处置，未知或带私密链接的错误只给通用重试信息', () => {
  for (const message of ['免费调用额度已暂停，请稍后再试', '微软授权已失效，请重新连接', '没有所选日历的写入权限',
    'Outlook 日程同步失败（503）', '洗头日程已被修改或添加参与人，请先核对']) expect(outlookStatusError(message)).toBe(message);
  for (const message of ['unknown token', 'Outlook 日程同步失败（503） https://private/token.ics', 'Make https://private/webhook'])
    expect(outlookStatusError(message)).toBe('日程同步暂未完成，请重试');
  expect(outlookStatusError(undefined)).toBeUndefined();
});
