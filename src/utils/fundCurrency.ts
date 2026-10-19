// Share-class currencies, verified against the fund manager's announcement:
// https://media.icbc.com.cn/fund/report/4505654_fcdb.pdf
const FUND_SHARE_CURRENCIES: Partial<Record<string, 'CNY' | 'USD'>> = {
  '003385': 'CNY',
  '003386': 'USD',
  '003387': 'CNY',
};

export function knownFundQuoteCurrency(symbol: string) {
  return FUND_SHARE_CURRENCIES[symbol.trim().toUpperCase().replace(/^(?:OF|0F|F)(?=\d{6}$)/, '')];
}

export function inferFundQuoteCurrency(symbol: string, name: string) {
  const known = knownFundQuoteCurrency(symbol);
  if (known) return known;
  if (/人民币/.test(name)) return 'CNY';
  // “美元债” describes the investments, not the share class's denomination.
  const shareClassName = name.replace(/美元债/g, '');
  if (/美元|美钞|美汇/.test(shareClassName)) return 'USD';
  if (/港币/.test(shareClassName)) return 'HKD';
  return 'CNY';
}
