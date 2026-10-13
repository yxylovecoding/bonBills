const FUND_SYMBOL_PREFIX = /^(?:OF|0F|F)(\d{6})$/i;

export function canonicalInvestmentName(raw: string) {
  return raw.normalize('NFKC').trim().replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ').toLowerCase();
}

export function canonicalInvestmentSymbol(raw: string) {
  const compact = raw.trim().toUpperCase().replace(/\s+/g, '').replace(/\.0+$/, '');
  const fund = compact.match(FUND_SYMBOL_PREFIX);
  return fund ? fund[1] : compact;
}

export function isPrefixedFundSymbol(raw: string) {
  return FUND_SYMBOL_PREFIX.test(raw.trim().replace(/\s+/g, ''));
}
