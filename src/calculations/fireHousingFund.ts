import type { AppConfig } from '../models/types';

export const FIRE_YEAR_MS = 365.25 * 86400000;
export const HOUSING_FUND_EXIT_WAIT_YEARS = 0.5;
const HANGZHOU_ANNUAL_RENT_WITHDRAWAL_LIMIT = 2000 * 12;

function parseDate(value: string | undefined | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  const [year, month, day] = value.split('-').map(Number);
  return Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
    ? null : date;
}

export function getFireEmploymentStartYears(config: AppConfig, now: Date): number {
  const graduation = parseDate(config.fireGraduationDate);
  return graduation ? Math.max((graduation.getTime() - now.getTime()) / FIRE_YEAR_MS, 0) : 0;
}

// 杭公积金〔2023〕36号：青年截至36周岁前一个月；新市民按最近落户月份起算3年。
// https://gjj.hangzhou.gov.cn/art/2023/12/29/art_1229468386_1839436.html
export function getFullHousingFundWithdrawalEndYears(config: AppConfig, now: Date): number {
  // bon 已确认非杭州户籍；旧配置未设置户籍时沿用此默认值。
  if (config.fireHasHangzhouHukou !== true) return Infinity;
  const birth = parseDate(config.birthDate);
  const hukou = parseDate(config.fireHangzhouHukouDate);
  const youthEnd = birth ? new Date(birth.getFullYear() + 36, birth.getMonth(), 1).getTime() : now.getTime();
  const residentEnd = hukou && hukou <= now
    ? new Date(hukou.getFullYear() + 3, hukou.getMonth(), 1).getTime()
    : now.getTime();
  return Math.max((Math.max(youthEnd, residentEnd) - now.getTime()) / FIRE_YEAR_MS, 0);
}

export function getHousingFundAnnualRentWithdrawalLimit(annualContribution: number, fullWithdrawal: boolean): number {
  // 杭房公委〔2023〕8号：无房青年/新市民按双边缴存额，普通市区租赁按2000元/月。
  // https://zfgb.hangzhou.gov.cn/11/105220253/t117220253054/518769.shtml
  return fullWithdrawal ? Math.max(annualContribution, HANGZHOU_ANNUAL_RENT_WITHDRAWAL_LIMIT) : HANGZHOU_ANNUAL_RENT_WITHDRAWAL_LIMIT;
}
