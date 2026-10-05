import { beforeEach, describe, expect, it } from 'vitest';
import { createAccountStorage, getAccountStorage, prepareAccountCache } from './accountCache';

const CACHE = 'bonbills-sync-cache-v1', PENDING = 'bonbills-sync-pending-v1';
const member = { authenticated: true, username: 'new', accountId: 'a'.repeat(32) };
const owner = { authenticated: true, username: 'bon', accountId: 'legacy' };
beforeEach(() => localStorage.clear());

describe('登录后的账本缓存归属', () => {
  it('保留原账号缓存及未上传修改并升级归属标记', () => {
    localStorage.setItem(CACHE, 'bon');
    localStorage.setItem('monthly-records', 'original');
    localStorage.setItem(PENDING, JSON.stringify({ owner: 'bon', stores: { 'monthly-records': {} } }));
    expect(prepareAccountCache(owner)).toBe('legacy');
    expect(getAccountStorage().getItem('monthly-records')).toBe('original');
    expect(JSON.parse(localStorage.getItem(PENDING)!)).toEqual({ owner: 'legacy', stores: { 'monthly-records': {} } });
  });

  it('新账号不继承旧账本或待迁移数据，切回原账号保留缓存与草稿', () => {
    localStorage.setItem('monthly-records', 'owner-bills');
    localStorage.setItem('billExpenseItems.override.v1', 'old-bills');
    localStorage.setItem(PENDING, JSON.stringify({ owner: 'legacy', stores: { 'monthly-records': {} } }));
    prepareAccountCache(member);
    const memberStorage = getAccountStorage();
    expect(memberStorage.getItem('monthly-records')).toBeNull();
    expect(memberStorage.getItem('billExpenseItems.override.v1')).toBeNull();
    expect(memberStorage.getItem(PENDING)).toBeNull();
    memberStorage.setItem('monthly-records', 'member-bills');
    prepareAccountCache(owner);
    expect(getAccountStorage().getItem('monthly-records')).toBe('owner-bills');
    expect(JSON.parse(getAccountStorage().getItem(PENDING)!).owner).toBe('legacy');
    expect(memberStorage.getItem('monthly-records')).toBe('member-bills');
  });

  it('新用户先登录不会改动尚未升级的旧账号本地数据', () => {
    localStorage.setItem(CACHE, 'bon');
    localStorage.setItem('monthly-records', 'old-bills');
    localStorage.setItem(PENDING, JSON.stringify({ owner: 'bon', stores: { 'monthly-records': {} } }));
    prepareAccountCache(member);
    expect(localStorage.getItem(CACHE)).toBe('bon');
    expect(JSON.parse(localStorage.getItem(PENDING)!).owner).toBe('bon');
    expect(getAccountStorage().getItem('monthly-records')).toBeNull();
    prepareAccountCache(owner);
    expect(getAccountStorage().getItem('monthly-records')).toBe('old-bills');
    expect(JSON.parse(getAccountStorage().getItem(PENDING)!).owner).toBe('legacy');
  });

  it('旧标签页延迟保存不会覆盖新账号的本地数据和草稿', () => {
    prepareAccountCache(owner);
    const oldTab = getAccountStorage();
    prepareAccountCache(member);
    const newTab = getAccountStorage();
    newTab.setItem('monthly-records', 'new-account');
    newTab.setItem(PENDING, 'new-pending');
    oldTab.setItem('monthly-records', 'late-owner-save');
    oldTab.removeItem(PENDING);
    expect(newTab.getItem('monthly-records')).toBe('new-account');
    expect(newTab.getItem(PENDING)).toBe('new-pending');
    expect(oldTab.getItem('monthly-records')).toBe('late-owner-save');
    const another = createAccountStorage('b'.repeat(32));
    expect(another.getItem('monthly-records')).toBeNull();
  });

  it('损坏的旧草稿元数据不阻止原账号登录或清空账本', () => {
    localStorage.setItem('monthly-records', 'old-bills');
    localStorage.setItem(PENDING, '{');
    expect(prepareAccountCache(owner)).toBe('legacy');
    expect(localStorage.getItem('monthly-records')).toBe('old-bills');
    expect(localStorage.getItem(PENDING)).toBe('{');
  });

  it('未认证或无效账号不触碰本地数据', () => {
    localStorage.setItem('monthly-records', 'original');
    expect(() => prepareAccountCache({ authenticated: false })).toThrow();
    expect(() => prepareAccountCache({ authenticated: true, accountId: 'wrong' })).toThrow();
    expect(localStorage.getItem('monthly-records')).toBe('original');
  });
});
