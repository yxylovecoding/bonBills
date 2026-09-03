import { useMemo } from 'react';
import { investMeta } from '../data/mockData';
import type { AutoAccountBalanceKey, InvestKey } from '../models/types';
import {
  diffInvestmentOperations,
  type FinanceImportPreviewDraft,
  type InvestmentOperationPreviewChange,
} from '../utils/importPreview';

const ACCOUNT_LABELS: Record<AutoAccountBalanceKey, string> = {
  credit: '信用卡',
  livingBank: '生活账户',
  incomeBank: '收入账户',
  investCnyBank: '人民币理财现金',
  investUsdBank: '美元理财现金',
};

const INVEST_KEYS = Object.keys(investMeta) as InvestKey[];

function number(value: number, maximumFractionDigits = 2) {
  return value.toLocaleString('zh-CN', { maximumFractionDigits });
}

function accountAmount(key: AutoAccountBalanceKey, value: number) {
  return `${key === 'investUsdBank' ? '$' : '¥'}${number(value)}`;
}

function operationDetails(change: InvestmentOperationPreviewChange) {
  if (change.kind === 'transaction') {
    const item = change.item;
    const amount = item.amount ?? item.shares * item.price;
    return {
      title: item.name,
      meta: `${(item.operationAt || item.occurredAt || item.date).slice(0, 16).replace('T', ' ')} · ${change.change === 'updated' ? '已更新' : '已确认'}`,
      action: item.side === 'buy' ? '买入' : '卖出',
      amount: `${item.currency} ${number(amount)}`,
    };
  }
  const status = change.change === 'added' ? '待确认' : change.change === 'updated' ? '已更新' : '已移除';
  return {
    title: change.item.name,
    meta: `${change.item.operationAt.slice(0, 16).replace('T', ' ')} · ${status}`,
    action: '买入',
    amount: change.item.amount ? `${change.item.currency} ${number(change.item.amount)}` : '金额待出',
  };
}

export default function FinanceImportPreviewDialog({
  draft,
  confirming,
  onCancel,
  onConfirm,
}: {
  draft: FinanceImportPreviewDraft;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const changesOnly = Boolean(draft.meta.changesOnly);
  const billsAlreadyImported = draft.meta.billMonths.length > 0;
  const { investmentRecords, accountChanges, holdingChanges, investmentOperationChanges } = useMemo(() => {
    const accounts = (Object.keys(ACCOUNT_LABELS) as AutoAccountBalanceKey[]).flatMap((key) => {
      const before = draft.before.snapshot.current.accounts[key];
      const after = draft.after.snapshot.current.accounts[key];
      return before === after ? [] : [{ key, before, after }];
    });
    if (changesOnly) {
      return {
        investmentRecords: [],
        accountChanges: accounts,
        holdingChanges: [],
        investmentOperationChanges: diffInvestmentOperations(draft.before.records, draft.after.records),
      };
    }
    return {
      investmentRecords: draft.meta.investmentMonths
        .map((month) => draft.after.records.find((record) => record.yearMonth === month))
        .filter((record): record is NonNullable<typeof record> => Boolean(record)),
      accountChanges: accounts,
      holdingChanges: INVEST_KEYS.flatMap((key) => {
        const before = draft.before.snapshot.current.investHoldings[key];
        const after = draft.after.snapshot.current.investHoldings[key];
        return before === after ? [] : [{ key, before, after }];
      }),
      investmentOperationChanges: [],
    };
  }, [changesOnly, draft]);

  return (
    <aside role="dialog" aria-modal="false" aria-labelledby="finance-import-preview-title" className="finance-import-preview-shell">
      <div className="finance-import-preview-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div>
            <div id="finance-import-preview-title" style={{ fontSize: 16, fontWeight: 800, color: '#202124' }}>{draft.meta.title}</div>
            <div style={{ fontSize: 11, color: '#5f6368', marginTop: 3 }}>
              {billsAlreadyImported ? '账单已导入 · 确认后更新账户和理财' : '确认后才会写入'}
            </div>
          </div>
          <button type="button" onClick={onCancel} disabled={confirming} aria-label="关闭导入预览" style={{ border: 'none', borderRadius: 8, backgroundColor: '#f1f3f4', color: '#5f6368', width: 30, height: 30, fontSize: 16, fontWeight: 800, cursor: confirming ? 'default' : 'pointer' }}>×</button>
        </div>

        {!changesOnly && <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
          {draft.meta.lines.map((line, index) => (
            <div key={`${index}:${line}`} style={{ padding: '7px 9px', borderRadius: 8, backgroundColor: '#f8f9fa', color: '#3c4043', fontSize: 12, fontWeight: 700 }}>{line}</div>
          ))}
        </div>}

        {!changesOnly && investmentRecords.map((record) => (
          <section key={record.yearMonth} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#1a73e8', marginBottom: 6 }}>理财 · {record.yearMonth}</div>
            <div style={{ border: '1px solid #e8eaed', borderRadius: 10, overflow: 'hidden' }}>
              {INVEST_KEYS.flatMap((key) => (record.investPositionItems?.[key] ?? [])
                .filter((item) => item.status !== 'closed' && ((item.shares ?? 0) > 0 || (item.pendingBuys?.length ?? 0) > 0))
                .map((item) => (
                  <div key={`${key}:${item.id}`} style={{ padding: '8px 9px', borderBottom: '1px solid #f1f3f4', fontSize: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: '#202124', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                        <div style={{ color: '#5f6368', fontSize: 10, marginTop: 2 }}>{investMeta[key].label} · {item.symbol || '汇总项'}</div>
                      </div>
                      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        <div style={{ color: '#202124', fontWeight: 800 }}>{number(item.shares ?? 0, 4)} 份</div>
                        <div style={{ color: '#5f6368', fontSize: 10, marginTop: 2 }}>成本 {number(item.costPrice ?? 0, 4)}</div>
                      </div>
                    </div>
                    {item.pendingBuys?.map((pending) => (
                      <div key={pending.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6, borderRadius: 7, backgroundColor: '#fff4e5', padding: '5px 7px', color: '#e8710a', fontSize: 10, fontWeight: 700 }}>
                        <span>待确认 · {pending.operationAt.slice(5, 16).replace('T', ' ')}</span>
                        <span>{pending.amount ? `${pending.currency} ${number(pending.amount)}` : '金额待出'}</span>
                      </div>
                    ))}
                  </div>
                )))}
            </div>
          </section>
        ))}

        {!changesOnly && draft.meta.billMonths.length > 0 && (
          <section style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#0d9488', marginBottom: 6 }}>账单</div>
            <div style={{ border: '1px solid #e8eaed', borderRadius: 10, overflow: 'hidden' }}>
              {draft.meta.billMonths.map((month) => {
                const aggregate = draft.after.billDetails.aggregates[month];
                return aggregate ? (
                  <div key={month} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 14, padding: '8px 9px', borderBottom: '1px solid #f1f3f4', fontSize: 12 }}>
                    <span style={{ fontWeight: 800 }}>{month}</span>
                    <span>收入 ¥{number(aggregate.income)}</span>
                    <span>支出 ¥{number(aggregate.totalExpense)}</span>
                  </div>
                ) : null;
              })}
            </div>
          </section>
        )}

        {(accountChanges.length > 0 || (!changesOnly && holdingChanges.length > 0)) && (
          <section style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#e8710a', marginBottom: 6 }}>{changesOnly ? '账户' : '对账变化'}</div>
            <div style={{ border: '1px solid #e8eaed', borderRadius: 10, overflow: 'hidden' }}>
              {accountChanges.map(({ key, before, after }) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 9px', borderBottom: '1px solid #f1f3f4', fontSize: 12 }}>
                  <span style={{ fontWeight: 700 }}>{ACCOUNT_LABELS[key]}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{accountAmount(key, before)} → {accountAmount(key, after)}</span>
                </div>
              ))}
              {!changesOnly && holdingChanges.map(({ key, before, after }) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 9px', borderBottom: '1px solid #f1f3f4', fontSize: 12 }}>
                  <span style={{ fontWeight: 700 }}>{investMeta[key].label}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>¥{number(before)} → ¥{number(after)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {changesOnly && investmentOperationChanges.length > 0 && (
          <section style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#1a73e8', marginBottom: 6 }}>理财操作</div>
            <div style={{ border: '1px solid #e8eaed', borderRadius: 10, overflow: 'hidden' }}>
              {investmentOperationChanges.map((change) => {
                const details = operationDetails(change);
                return (
                  <div key={`${change.kind}:${change.change}:${change.item.id}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, padding: '8px 9px', borderBottom: '1px solid #f1f3f4', fontSize: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: '#202124', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{details.title}</div>
                      <div style={{ color: '#5f6368', fontSize: 10, marginTop: 2 }}>{details.meta}</div>
                    </div>
                    <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      <div style={{ color: '#202124', fontWeight: 800 }}>{details.action}</div>
                      <div style={{ color: '#5f6368', fontSize: 10, marginTop: 2 }}>{details.amount}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {changesOnly && accountChanges.length === 0 && investmentOperationChanges.length === 0 && (
          <div style={{ marginBottom: 12, borderRadius: 10, backgroundColor: '#f8f9fa', color: '#5f6368', padding: '12px', textAlign: 'center', fontSize: 12, fontWeight: 700 }}>
            账户和理财操作无变动
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button type="button" onClick={onCancel} disabled={confirming} style={{ border: '1px solid #dadce0', borderRadius: 10, backgroundColor: '#fff', color: '#5f6368', padding: '10px 0', fontSize: 13, fontWeight: 800, cursor: confirming ? 'default' : 'pointer' }}>{billsAlreadyImported ? '保持不变' : '取消'}</button>
          <button type="button" onClick={onConfirm} disabled={confirming} style={{ border: 'none', borderRadius: 10, backgroundColor: confirming ? '#9aa0a6' : '#1a73e8', color: '#fff', padding: '10px 0', fontSize: 13, fontWeight: 800, cursor: confirming ? 'default' : 'pointer' }}>{confirming ? '写入中' : billsAlreadyImported ? '更新账户和理财' : '确认导入'}</button>
        </div>
      </div>
    </aside>
  );
}
