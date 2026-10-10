import { validConfirmationDate } from './alipayHoldings';
import { fetchPendingFundNavs } from './pendingFundEstimate';

export interface AlipayActualNav { code: string; date: string; nav: number }

/** The existing month endpoint covers two months, including the previous month's closing NAV.
 * Only public fund identifiers leave the browser. Snapshot amounts and orders are not sent.
 */
export async function fetchAlipayActualNav(code: string, asOf: string): Promise<AlipayActualNav | undefined> {
  if (!/^\d{6}$/.test(code) || !validConfirmationDate(asOf)) return undefined;
  const [year, month] = asOf.split('-').map(Number);
  const startMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const bars = await fetchPendingFundNavs(code, startMonth);
  const latest = bars.filter((bar) => validConfirmationDate(bar.date) && bar.date >= `${startMonth}-01` && bar.date <= asOf)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  // Purchase suspension does not prevent existing shares from being valued.
  return latest ? { code, date: latest.date, nav: latest.close } : undefined;
}
