import { useEffect, useState } from 'react';
import type { AlipayActualSnapshot } from '../models/types';
import { fetchAlipayActualNav, type AlipayActualNav } from '../utils/alipayActualNav';

type NavResult = { quote?: AlipayActualNav };

export function useAlipayActualNavs(snapshot: AlipayActualSnapshot) {
  const date = snapshot.date;
  const codes = snapshot.funds.filter((fund) => fund.shares === undefined && fund.nav === undefined)
    .map((fund) => fund.code).sort().join(',');
  const key = `${date}:${codes}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; results: Record<string, NavResult> }>({ key: '', results: {} });
  useEffect(() => {
    let active = true;
    setState({ key, results: {} });
    // Requests settle independently so one unavailable fund cannot delay the other holdings.
    for (const code of codes.split(',').filter(Boolean)) {
      void fetchAlipayActualNav(code, date).catch(() => undefined).then((quote) => {
        if (active) setState((current) => ({ key, results: { ...current.results, [code]: { quote } } }));
      });
    }
    return () => { active = false; };
  }, [codes, date, key, attempt]);
  // A new snapshot must never render quotes left over from a later date.
  const results = state.key === key ? state.results : {};
  const missing = codes.split(',').filter(Boolean);
  return {
    results,
    loading: missing.some((code) => !results[code]),
    failed: missing.some((code) => results[code] && !results[code].quote),
    retry: () => setAttempt((value) => value + 1),
  };
}
