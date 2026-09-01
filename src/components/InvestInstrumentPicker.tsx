import { useEffect, useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { InvestQuoteSource } from '../models/types';

type MarketSearchResult = {
  symbol: string;
  name: string;
  type: string;
  market: string;
  currency: string;
  source: InvestQuoteSource;
};

type InvestInstrumentPickerProps = {
  name: string;
  symbol: string;
  quoteSource?: InvestQuoteSource;
  ariaLabel: string;
  onChange: (patch: { name?: string; symbol?: string; quoteSource?: InvestQuoteSource; quoteCurrency?: string }) => void;
};

const SOURCE_LABELS: Record<InvestQuoteSource, string> = {
  yahoo: '交易行情',
  'eastmoney-fund': '基金净值',
};

export default function InvestInstrumentPicker({
  name,
  symbol,
  quoteSource,
  ariaLabel,
  onChange,
}: InvestInstrumentPickerProps) {
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [results, setResults] = useState<MarketSearchResult[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const hasMatchedInstrument = Boolean(symbol.trim() && quoteSource);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!open || !normalizedQuery) {
      setLoading(false);
      setFailed(false);
      setResults([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      setFailed(false);
      try {
        const response = await fetch(`/api/market-search?q=${encodeURIComponent(normalizedQuery)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as { results?: MarketSearchResult[] };
        if (controller.signal.aborted) return;
        setResults(payload.results ?? []);
        setHighlightedIndex(0);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setResults([]);
        setFailed(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  const choose = (result: MarketSearchResult) => {
    onChange({ name: result.name, symbol: result.symbol, quoteSource: result.source, quoteCurrency: result.currency });
    setQuery('');
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      if (results.length > 0) {
        setHighlightedIndex((current) => event.key === 'ArrowDown'
          ? (current + 1) % results.length
          : (current - 1 + results.length) % results.length);
      }
      return;
    }
    if (event.key === 'Enter' && open && results[highlightedIndex]) {
      event.preventDefault();
      choose(results[highlightedIndex]);
    }
  };

  const showMenu = open && Boolean(query.trim());
  return (
    <div style={{ position: 'relative', minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 72px', gap: 6 }}>
      <input
        aria-label={`${ariaLabel}名称`}
        aria-autocomplete="list"
        aria-controls={showMenu ? listboxId : undefined}
        aria-expanded={showMenu}
        value={name}
        placeholder="名称"
        onFocus={(event) => {
          event.currentTarget.select();
          if (!hasMatchedInstrument) {
            setQuery(name);
            setOpen(true);
          }
        }}
        onChange={(event) => {
          const value = event.target.value;
          onChange({ name: value });
          if (hasMatchedInstrument) {
            setQuery('');
            setOpen(false);
          } else {
            setQuery(value);
            setOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        style={{ minWidth: 0, width: '100%', border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', fontSize: 12, fontWeight: 800, backgroundColor: 'transparent' }}
      />
      <input
        aria-label={`${name || ariaLabel}行情代码`}
        aria-autocomplete="list"
        aria-controls={showMenu ? listboxId : undefined}
        aria-expanded={showMenu}
        value={symbol}
        placeholder="代码"
        title={quoteSource ? SOURCE_LABELS[quoteSource] : '输入后从候选项选择'}
        onFocus={(event) => {
          event.currentTarget.select();
          setQuery(symbol);
          setOpen(true);
        }}
        onChange={(event) => {
          const value = event.target.value.toUpperCase();
          onChange({ symbol: value, quoteSource: undefined, quoteCurrency: undefined });
          setQuery(value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        style={{ minWidth: 0, width: '100%', border: 'none', borderBottom: '1px solid #dadce0', outline: 'none', fontSize: 11, fontWeight: 700, color: '#1a73e8', textAlign: 'right', backgroundColor: 'transparent' }}
      />

      {showMenu && (
        <div id={listboxId} role="listbox" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 30, maxHeight: 224, overflowY: 'auto', border: '1px solid #dadce0', borderRadius: 8, backgroundColor: '#fff', boxShadow: '0 6px 18px rgba(32,33,36,0.16)' }}>
          {loading ? (
            <div role="status" style={{ padding: '9px 10px', fontSize: 11, color: '#5f6368' }}>搜索中…</div>
          ) : failed ? (
            <div role="status" style={{ padding: '9px 10px', fontSize: 11, color: '#ea4335' }}>搜索失败</div>
          ) : results.length === 0 ? (
            <div role="status" style={{ padding: '9px 10px', fontSize: 11, color: '#5f6368' }}>无匹配项</div>
          ) : results.map((result, index) => (
            <button
              key={`${result.source}:${result.symbol}`}
              type="button"
              role="option"
              aria-selected={highlightedIndex === index}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => choose(result)}
              style={{ width: '100%', border: 'none', borderBottom: index < results.length - 1 ? '1px solid #f1f3f4' : 'none', padding: '7px 9px', backgroundColor: highlightedIndex === index ? '#e8f0fe' : '#fff', textAlign: 'left', cursor: 'pointer' }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: '#202124', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{result.name}</div>
              <div style={{ marginTop: 2, fontSize: 9, color: '#5f6368', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {result.symbol} · {result.market || result.type} · {SOURCE_LABELS[result.source]}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
