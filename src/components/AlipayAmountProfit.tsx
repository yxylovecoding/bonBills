const formatMoney = (value: number | null, currency: string, signed = false) => value === null ? '—' : new Intl.NumberFormat('zh-CN', {
  style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: signed ? 'exceptZero' : 'auto',
}).format(value);

export default function AlipayAmountProfit({ amount, holdingProfit, currency = 'CNY', profitCurrency = currency }: {
  amount: number | null; holdingProfit: number | null; currency?: string; profitCurrency?: string;
}) {
  return <span className="alipay-amount-profit">
    <span><span className="alipay-metric-label">金额</span><b>{formatMoney(amount, currency)}</b></span>
    <span><span className="alipay-metric-label">持有收益</span><b style={{ color: holdingProfit === null || holdingProfit === 0 ? '#5f6368' : holdingProfit > 0 ? '#ea4335' : '#0d9488' }}>{formatMoney(holdingProfit, profitCurrency, true)}</b></span>
  </span>;
}
