import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingInvestmentBuy } from '../models/types';
import { estimatePendingFundBuy, pendingFundNavStartDate, type FundNavBar } from './pendingFundEstimate';

const order: PendingInvestmentBuy = {
  id: 'pending-1', matchKey: 'order-1', baseMatchKey: 'base-1',
  operationAt: '2026-09-17T09:18:00', amount: 10, currency: 'CNY',
  account: '中国银行1721', name: '摩根标普A', symbol: '017641', groupKey: 'us',
};
const now = Date.parse('2026-09-22T10:00:00+08:00');
const navs: FundNavBar[] = [
  { date: '2026-09-18', close: 1.6952, purchaseStatus: '限制大额申购' },
  { date: '2026-09-17', close: 1.6939, purchaseStatus: '限制大额申购' },
];

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('待确认基金的净值与份额预估', () => {
  it('上午申购采用当日净值，不使用最新净值或重复计入持仓', () => {
    const before = structuredClone(order);
    expect(estimatePendingFundBuy(order, navs, now)).toEqual({ navDate: '2026-09-17', price: 1.6939, shares: 5.9, beforeFee: true });
    expect(order).toEqual(before);
  });

  it('15 点前后分别对应当日与下一日，时区固定为北京时间', () => {
    expect(pendingFundNavStartDate('2026-09-17T14:59:59')).toBe('2026-09-17');
    expect(pendingFundNavStartDate('2026-09-17T15:00:00')).toBe('2026-09-18');
    expect(pendingFundNavStartDate('2026-09-17T07:00:00Z')).toBe('2026-09-18');
    expect(estimatePendingFundBuy({ ...order, operationAt: '2026-09-17T15:00:00' }, navs, now)?.price).toBe(1.6952);
  });

  it('周五收盘后跨过周末和暂停申购日，使用下个开放日', () => {
    const bars: FundNavBar[] = [
      { date: '2026-09-19', close: 1.8, purchaseStatus: '开放申购' },
      { date: '2026-09-21', close: 1.9, purchaseStatus: '暂停申购' },
      { date: '2026-09-22', close: 2, purchaseStatus: '开放申购' },
    ];
    expect(estimatePendingFundBuy({ ...order, operationAt: '2026-09-18T15:00:00' }, bars, now)?.navDate).toBe('2026-09-22');
  });

  it('月末与年末截单正确跨月，次月净值未出不沿用旧净值', () => {
    expect(pendingFundNavStartDate('2026-09-30T15:00:00')).toBe('2026-10-01');
    expect(pendingFundNavStartDate('2026-12-31T15:00:00')).toBe('2027-01-01');
    expect(estimatePendingFundBuy({ ...order, operationAt: '2026-09-18T15:00:00' }, navs, now)).toBeNull();
  });

  it('明确手续费先扣费，零费用与未知费用保持区别', () => {
    const bars = [{ date: '2026-09-17', close: 2, purchaseStatus: '开放申购' }];
    expect(estimatePendingFundBuy({ ...order, fee: 0.1 }, bars, now)).toMatchObject({ shares: 4.95, beforeFee: false });
    expect(estimatePendingFundBuy({ ...order, fee: 0 }, bars, now)).toMatchObject({ shares: 5, beforeFee: false });
    expect(estimatePendingFundBuy(order, bars, now)).toMatchObject({ shares: 5, beforeFee: true });
  });

  it('缺少操作时间、金额或有无效手续费时不猜测', () => {
    expect(pendingFundNavStartDate('2026-09-17')).toBeNull();
    expect(pendingFundNavStartDate('2026-02-31T10:00:00')).toBeNull();
    for (const patch of [{ operationAt: '2026-09-17' }, { amount: undefined }, { amount: 0 }, { fee: -1 }, { fee: 10 }]) {
      expect(estimatePendingFundBuy({ ...order, ...patch }, navs, now)).toBeNull();
    }
  });

  it('不使用无效、未来、没有申购状态的净值', () => {
    for (const bar of [
      { date: '2026-09-17', close: 0, purchaseStatus: '开放申购' },
      { date: '2026-09-17', close: NaN, purchaseStatus: '开放申购' },
      { date: '2026-09-17', close: 2, purchaseStatus: '' },
      { date: '2026-09-23', close: 2, purchaseStatus: '开放申购' },
    ]) expect(estimatePendingFundBuy(order, [bar], now)).toBeNull();
  });
});

describe('共享净值查询', () => {
  it('相同基金同月份的多笔买入复用请求，到期后自动更新', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const { fetchPendingFundNavs } = await import('./pendingFundEstimate');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ symbol: '017641', startDate: '2026-09-01', bars: navs }) });
    vi.stubGlobal('fetch', fetchMock);
    const first = fetchPendingFundNavs('017641', '2026-09');
    const second = fetchPendingFundNavs('017641', '2026-09');
    expect(first).toBe(second);
    expect(await first).toEqual(navs);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('navMonth=2026-09');
    expect(url).not.toContain('1721');
    expect(url).not.toContain('amount');
    vi.advanceTimersByTime(15 * 60_000);
    await fetchPendingFundNavs('017641', '2026-09');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('接口失败后短暂退避，再次请求可以恢复', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const { fetchPendingFundNavs } = await import('./pendingFundEstimate');
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true, json: async () => ({ symbol: '017641', startDate: '2026-09-01', bars: navs }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchPendingFundNavs('017641', '2026-09')).rejects.toThrow();
    await expect(fetchPendingFundNavs('017641', '2026-09')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(await fetchPendingFundNavs('017641', '2026-09')).toEqual(navs);
  });

  it('不接受错基金、错月份的结果', async () => {
    vi.resetModules();
    const { fetchPendingFundNavs } = await import('./pendingFundEstimate');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ symbol: '019305', startDate: '2026-09-01', bars: navs }) }));
    await expect(fetchPendingFundNavs('017641', '2026-09')).rejects.toThrow('invalid NAV history');
  });
});
