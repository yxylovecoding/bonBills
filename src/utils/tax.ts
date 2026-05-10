export interface IncomeTaxResult {
  grossAmount: number;
  taxAmount: number;
  netAmount: number;
  ruleSummary?: string;
  ruleError?: string;
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

function roundMoney(value: number) {
  return Math.round(value * MONEY_ROUNDING) / MONEY_ROUNDING;
}

function clampTax(tax: number, grossAmount: number) {
  if (!Number.isFinite(tax)) return 0;
  return roundMoney(Math.min(Math.max(tax, 0), Math.max(grossAmount, 0)));
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
