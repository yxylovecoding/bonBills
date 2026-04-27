import { useEffect, useMemo, useState } from 'react';

export interface HolidayInfo {
  date: string;
  name?: string;
  isOffDay: boolean;
}

export type HolidayYearData = Record<string, HolidayInfo>;
export type HolidayDataByYear = Record<number, HolidayYearData>;

interface HolidayFetchResult {
  data: HolidayYearData;
  warning?: string;
}

const STORAGE_KEY_PREFIX = 'holiday-calendar-year:';
const memoryCache = new Map<number, HolidayYearData>();
const inflight = new Map<number, Promise<HolidayFetchResult>>();

function getStorageKey(year: number) {
  return `${STORAGE_KEY_PREFIX}${year}`;
}

function readLocalCache(year: number): HolidayYearData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(getStorageKey(year));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as HolidayYearData;
  } catch {
    return null;
  }
}

function writeLocalCache(year: number, data: HolidayYearData) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getStorageKey(year), JSON.stringify(data));
  } catch {
    // Ignore quota/storage errors and continue with in-memory cache.
  }
}

async function fetchHolidayYear(year: number): Promise<HolidayFetchResult> {
  const memoized = memoryCache.get(year);
  if (memoized) return { data: memoized };

  const cached = readLocalCache(year);
  if (cached) {
    memoryCache.set(year, cached);
    return { data: cached };
  }

  const pending = inflight.get(year);
  if (pending) return pending;

  const request = (async () => {
    try {
      const response = await fetch(`/api/holidays?year=${year}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('invalid payload');
      }
      memoryCache.set(year, data as HolidayYearData);
      writeLocalCache(year, data as HolidayYearData);
      return { data: data as HolidayYearData };
    } catch {
      return {
        data: {},
        warning: `${year} 年节假日接口不可用，暂按周末口径计算实习发薪日`,
      };
    } finally {
      inflight.delete(year);
    }
  })();

  inflight.set(year, request);
  return request;
}

export function useHolidayYears(years: number[]) {
  const yearsKey = years.join(',');
  const normalizedYears = useMemo(
    () => [...new Set(years)].filter((year) => Number.isFinite(year)).sort((a, b) => a - b),
    [yearsKey],
  );

  const [dataByYear, setDataByYear] = useState<HolidayDataByYear>({});
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState('');

  useEffect(() => {
    if (normalizedYears.length === 0) {
      setLoading(false);
      setWarning('');
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all(normalizedYears.map(async (year) => ({ year, ...(await fetchHolidayYear(year)) })))
      .then((results) => {
        if (cancelled) return;
        setDataByYear((prev) => {
          const next = { ...prev };
          for (const result of results) next[result.year] = result.data;
          return next;
        });
        setWarning(results.map((result) => result.warning).filter(Boolean).join('；'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedYears]);

  return { holidayDataByYear: dataByYear, holidayLoading: loading, holidayWarning: warning };
}
