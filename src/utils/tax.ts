export interface IncomeTaxResult {
  grossAmount: number;
  taxAmount: number;
  netAmount: number;
  ruleSummary?: string;
  ruleError?: string;
}

export interface AnnualComprehensiveTaxResult {
  grossAnnualIncome: number;
  socialInsuranceAmount: number;
  housingFundAmount: number;
  socialContributionAmount: number;
  socialContributionRate: number;
  taxableIncome: number;
  taxAmount: number;
  netAnnualIncome: number;
  effectiveTaxRate: number;
  marginalTaxRate: number;
  taxSegments: AnnualComprehensiveTaxSegment[];
}

export interface AnnualComprehensiveTaxSegment {
  taxableAmount: number;
  rate: number;
  taxAmount: number;
}

export interface AnnualSocialContributionPolicy {
  socialInsuranceRate: number;
  socialInsuranceMonthlyBaseMin: number;
  socialInsuranceMonthlyBaseMax: number;
  housingFundRate: number;
  housingFundMonthlyBaseMin: number;
  housingFundMonthlyBaseMax: number;
  annualSpecialAdditionalDeduction: number;
}

export const TAX_RULE_PRESETS = [
  {
    key: 'bytedanceIntern',
    label: '字节实习',
    text: '税=(0.8x-5000)*20%',
  },
  {
    key: 'laborService',
    label: '普通劳务',
    text: '劳务报酬',
  },
] as const;

const MONEY_ROUNDING = 100;
const ANNUAL_BASIC_DEDUCTION = 60000;
// 截至 2026-07-13 的杭州最新已公布口径：社保 2025 年、公积金上限 2025 年度、下限按 2026 年市区最低工资。
export const HANGZHOU_EMPLOYEE_SOCIAL_INSURANCE_RATE = 0.105;
export const HANGZHOU_DEFAULT_HOUSING_FUND_RATE = 0.12;
export const HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MIN = 4986;
export const HANGZHOU_SOCIAL_INSURANCE_MONTHLY_BASE_MAX = 25299;
export const HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MIN = 2660;
export const HANGZHOU_HOUSING_FUND_MONTHLY_BASE_MAX = 40694;
const ANNUAL_COMPREHENSIVE_TAX_BRACKETS = [
  { limit: 36000, rate: 0.03 },
  { limit: 144000, rate: 0.10 },
  { limit: 300000, rate: 0.20 },
  { limit: 420000, rate: 0.25 },
  { limit: 660000, rate: 0.30 },
  { limit: 960000, rate: 0.35 },
  { limit: Infinity, rate: 0.45 },
] as const;

function roundMoney(value: number) {
  return Math.round(value * MONEY_ROUNDING) / MONEY_ROUNDING;
}

function clampTax(tax: number, grossAmount: number) {
  if (!Number.isFinite(tax)) return 0;
  return roundMoney(Math.min(Math.max(tax, 0), Math.max(grossAmount, 0)));
}

function ceilMoney(value: number) {
  return Math.ceil(value * MONEY_ROUNDING) / MONEY_ROUNDING;
}

function normalizeRate(rate: number | undefined, fallback = 0) {
  return Math.min(Math.max(Number.isFinite(rate) ? Number(rate) : fallback, 0), 0.99);
}

function calculateAnnualContribution(
  grossAnnualIncome: number,
  rate: number,
  monthlyBaseMin: number,
  monthlyBaseMax: number,
) {
  if (grossAnnualIncome <= 0 || rate <= 0) return 0;
  const monthlyGross = grossAnnualIncome / 12;
  const safeBaseMin = Math.max(Number.isFinite(monthlyBaseMin) ? monthlyBaseMin : 0, 0);
  const safeBaseMax = Math.max(Number.isFinite(monthlyBaseMax) ? monthlyBaseMax : Infinity, safeBaseMin);
  const monthlyBase = Math.min(Math.max(monthlyGross, safeBaseMin), safeBaseMax);
  return roundMoney(monthlyBase * rate * 12);
}

export function calculateAnnualComprehensiveTax(
  grossAnnualIncome: number,
  contributionPolicy?: Partial<AnnualSocialContributionPolicy>,
): AnnualComprehensiveTaxResult {
  const safeGross = roundMoney(Math.max(Number.isFinite(grossAnnualIncome) ? grossAnnualIncome : 0, 0));
  const socialInsuranceRate = normalizeRate(contributionPolicy?.socialInsuranceRate);
  const housingFundRate = normalizeRate(contributionPolicy?.housingFundRate);
  const socialInsuranceAmount = calculateAnnualContribution(
    safeGross,
    socialInsuranceRate,
    contributionPolicy?.socialInsuranceMonthlyBaseMin ?? 0,
    contributionPolicy?.socialInsuranceMonthlyBaseMax ?? Infinity,
  );
  const housingFundAmount = calculateAnnualContribution(
    safeGross,
    housingFundRate,
    contributionPolicy?.housingFundMonthlyBaseMin ?? 0,
    contributionPolicy?.housingFundMonthlyBaseMax ?? Infinity,
  );
  const socialContributionAmount = roundMoney(socialInsuranceAmount + housingFundAmount);
  const socialContributionRate = safeGross > 0 ? socialContributionAmount / safeGross : 0;
  const annualSpecialAdditionalDeduction = Math.max(
    Number.isFinite(contributionPolicy?.annualSpecialAdditionalDeduction)
      ? Number(contributionPolicy?.annualSpecialAdditionalDeduction)
      : 0,
    0,
  );
  const taxableIncome = roundMoney(Math.max(
    safeGross - socialContributionAmount - ANNUAL_BASIC_DEDUCTION - annualSpecialAdditionalDeduction,
    0,
  ));
  const taxSegments: AnnualComprehensiveTaxSegment[] = [];
  let previousLimit = 0;
  let remainingTaxable = taxableIncome;
  let marginalTaxRate = 0;

  for (const bracket of ANNUAL_COMPREHENSIVE_TAX_BRACKETS) {
    if (remainingTaxable <= 0) break;
    const bracketSize = bracket.limit === Infinity ? remainingTaxable : bracket.limit - previousLimit;
    const taxableAmount = roundMoney(Math.min(remainingTaxable, bracketSize));
    if (taxableAmount > 0) {
      const segmentTax = roundMoney(taxableAmount * bracket.rate);
      taxSegments.push({ taxableAmount, rate: bracket.rate, taxAmount: segmentTax });
      marginalTaxRate = bracket.rate;
      remainingTaxable = roundMoney(remainingTaxable - taxableAmount);
    }
    previousLimit = bracket.limit;
  }

  const taxAmount = clampTax(taxSegments.reduce((sum, segment) => sum + segment.taxAmount, 0), safeGross);
  const netAnnualIncome = roundMoney(safeGross - socialContributionAmount - taxAmount);

  return {
    grossAnnualIncome: safeGross,
    socialInsuranceAmount,
    housingFundAmount,
    socialContributionAmount,
    socialContributionRate,
    taxableIncome,
    taxAmount,
    netAnnualIncome,
    effectiveTaxRate: safeGross > 0 ? taxAmount / safeGross : 0,
    marginalTaxRate,
    taxSegments,
  };
}

export function estimateGrossAnnualIncomeForNet(
  targetNetAnnualIncome: number,
  contributionPolicy?: Partial<AnnualSocialContributionPolicy>,
): AnnualComprehensiveTaxResult {
  return estimateGrossAnnualIncomeForResources(targetNetAnnualIncome, contributionPolicy);
}

export function estimateGrossAnnualIncomeForResources(
  targetAnnualResources: number,
  contributionPolicy?: Partial<AnnualSocialContributionPolicy>,
  resourceCredit: (result: AnnualComprehensiveTaxResult) => number = () => 0,
): AnnualComprehensiveTaxResult {
  const targetNet = roundMoney(Math.max(Number.isFinite(targetAnnualResources) ? targetAnnualResources : 0, 0));
  if (targetNet <= 0) return calculateAnnualComprehensiveTax(0, contributionPolicy);

  const resourcesFor = (gross: number) => {
    const result = calculateAnnualComprehensiveTax(gross, contributionPolicy);
    return result.netAnnualIncome + Math.max(resourceCredit(result), 0);
  };

  let low = 0;
  let high = Math.max(targetNet, ANNUAL_BASIC_DEDUCTION);
  while (resourcesFor(high) < targetNet) {
    high *= 2;
  }

  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (resourcesFor(mid) >= targetNet) {
      high = mid;
    } else {
      low = mid;
    }
  }

  let gross = ceilMoney(high);
  let result = calculateAnnualComprehensiveTax(gross, contributionPolicy);
  while (result.netAnnualIncome + Math.max(resourceCredit(result), 0) < targetNet) {
    gross = ceilMoney(gross + 0.01);
    result = calculateAnnualComprehensiveTax(gross, contributionPolicy);
  }
  return result;
}

function normalizeRule(text: string) {
  return text
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/，/g, ',')
    .replace(/。/g, ';')
    .replace(/；/g, ';')
    .replace(/：/g, ':')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/￥|¥|元/g, '')
    .trim();
}

function parsePercent(text: string) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  return Number(match[1]) / 100;
}

function calculateLaborServiceTax(grossAmount: number) {
  const taxable = grossAmount <= 4000
    ? Math.max(grossAmount - 800, 0)
    : grossAmount * 0.8;

  let tax = 0;
  if (taxable <= 0) {
    tax = 0;
  } else if (taxable <= 20000) {
    tax = taxable * 0.2;
  } else if (taxable <= 50000) {
    tax = taxable * 0.3 - 2000;
  } else {
    tax = taxable * 0.4 - 7000;
  }

  return {
    taxAmount: clampTax(tax, grossAmount),
    summary: grossAmount <= 800
      ? '劳务报酬：800元内不扣税'
      : grossAmount <= 4000
        ? '劳务报酬：(收入-800)*20%'
        : '劳务报酬：收入*80%后按预扣率表',
  };
}

function extractFormula(text: string) {
  const assignment = text.match(/(?:扣税|税额|税)\s*[:=]\s*(.+)$/i);
  if (assignment) return assignment[1].trim();
  if (/^(=)/.test(text)) return text.slice(1).trim();
  if (/(收入|税前|金额|gross|amount|x)/i.test(text) && /[+\-*/]/.test(text)) return text;
  return null;
}

function evaluateTaxFormula(formula: string, grossAmount: number) {
  let expression = normalizeRule(formula).toLowerCase();
  expression = expression.replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)');
  expression = expression
    .replace(/最大值?|max/g, '__MAX__')
    .replace(/最小值?|min/g, '__MIN__');

  expression = expression
    .replace(/(\d(?:\.\d+)?|\))\s*(收入|税前|金额|gross|amount|x)/g, '$1*$2')
    .replace(/收入|税前|金额|gross|amount|x/g, `(${grossAmount})`)
    .replace(/__MAX__/g, 'Math.max')
    .replace(/__MIN__/g, 'Math.min');

  const withoutAllowedFunctions = expression.replace(/Math\.(?:max|min)/g, '');
  if (!/^[0-9+\-*/().,\s]+$/.test(withoutAllowedFunctions)) return null;

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('Math', `"use strict"; return (${expression});`);
    const result = fn(Math);
    return typeof result === 'number' && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

function calculateThresholdRateTax(text: string, grossAmount: number) {
  const rate = parsePercent(text);
  if (rate === null) return null;

  const deductionMatch = text.match(/(?:起征|免征|免税|扣除|减除|超过|超出)\D*(\d+(?:\.\d+)?)/);
  if (!deductionMatch) return null;

  const deduction = Number(deductionMatch[1]);
  return {
    taxAmount: clampTax(Math.max(grossAmount - deduction, 0) * rate, grossAmount),
    summary: `超过${deduction}元部分扣${roundMoney(rate * 100)}%`,
  };
}

function calculateFlatRateTax(text: string, grossAmount: number) {
  const rate = parsePercent(text);
  if (rate === null) return null;
  return {
    taxAmount: clampTax(grossAmount * rate, grossAmount),
    summary: `按${roundMoney(rate * 100)}%扣税`,
  };
}

export function calculateIncomeTax(grossAmount: number, taxRuleText?: string): IncomeTaxResult {
  const safeGross = roundMoney(Math.max(Number.isFinite(grossAmount) ? grossAmount : 0, 0));
  const rawRule = taxRuleText?.trim();
  if (!rawRule) {
    return { grossAmount: safeGross, taxAmount: 0, netAmount: safeGross };
  }

  const rule = normalizeRule(rawRule);
  if (!rule || /^(无|不扣税?|无需扣税|免税|0)$/.test(rule)) {
    return {
      grossAmount: safeGross,
      taxAmount: 0,
      netAmount: safeGross,
      ruleSummary: '不扣税',
    };
  }

  const formula = extractFormula(rule);
  if (formula) {
    const taxAmount = evaluateTaxFormula(formula, safeGross);
    if (taxAmount !== null) {
      const clamped = clampTax(taxAmount, safeGross);
      return {
        grossAmount: safeGross,
        taxAmount: clamped,
        netAmount: roundMoney(safeGross - clamped),
        ruleSummary: '按公式扣税',
      };
    }
  }

  if (/劳务|报酬|兼职/.test(rule)) {
    const result = calculateLaborServiceTax(safeGross);
    return {
      grossAmount: safeGross,
      taxAmount: result.taxAmount,
      netAmount: roundMoney(safeGross - result.taxAmount),
      ruleSummary: result.summary,
    };
  }

  const thresholdRate = calculateThresholdRateTax(rule, safeGross);
  if (thresholdRate) {
    return {
      grossAmount: safeGross,
      taxAmount: thresholdRate.taxAmount,
      netAmount: roundMoney(safeGross - thresholdRate.taxAmount),
      ruleSummary: thresholdRate.summary,
    };
  }

  const flatRate = calculateFlatRateTax(rule, safeGross);
  if (flatRate) {
    return {
      grossAmount: safeGross,
      taxAmount: flatRate.taxAmount,
      netAmount: roundMoney(safeGross - flatRate.taxAmount),
      ruleSummary: flatRate.summary,
    };
  }

  return {
    grossAmount: safeGross,
    taxAmount: 0,
    netAmount: safeGross,
    ruleError: '暂时没读懂这条扣税规则',
  };
}
