import { usePrefsStore } from '../stores/prefsStore';

export default function HoldingsViewToggle() {
  const view = usePrefsStore((state) => state.investmentHoldingsView);
  const setView = usePrefsStore((state) => state.setInvestmentHoldingsView);
  const alipay = view === 'alipay';
  return <button type="button" className="holdings-mode-pill" aria-pressed={alipay}
    aria-label={`持仓模式：${alipay ? '支付宝' : '一木'}，点击切换${alipay ? '一木' : '支付宝'}`}
    onClick={() => setView(alipay ? 'yimu' : 'alipay')}>
    {alipay ? '支付宝' : '一木'} <span aria-hidden="true">⇄</span>
  </button>;
}
