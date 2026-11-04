// Only return messages produced by our own code. Upstream errors can contain
// private ICS/Webhook URLs or credentials and must not reach the overview.
export function outlookStatusError(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  if (/^(免费调用额度已暂停，请稍后再试|微软授权已失效，请重新连接|没有所选日历的写入权限|Make 未返回日历执行结果，请检查场景|Make 未返回有效日历执行结果|Make 日历执行结果不完整|Outlook 日程同步暂不可用，请重试|日程版本不可用，请稍后重试|日程正在同步，请稍后重试|同步锁已失效，请稍后重试)$/.test(value)
    || /^(Make|Activepieces) (免费调用额度已暂停，请稍后再试|暂不可用，请稍后重试|未返回日历执行结果，请检查连接|未返回有效日历执行结果|日历执行结果不完整)$/.test(value)
    || /^Outlook 日程同步失败（\d{3}）$/.test(value)
    || /^(洗衣服?|洗头|电动车充电|接电动车)日程(已被修改或添加参与人，请先核对|已取消，请先核对)$/.test(value)) return value;
  return '日程同步暂未完成，请重试';
}
