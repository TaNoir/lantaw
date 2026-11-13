import { db, putCache, type AppSettings } from './db';
import type { FxRate } from './engine-types';
import bundled from './data/holidays-ph.json';
import { DAVAO_LOCAL } from './data/davao';

type Holiday = { date: string; name: string };

const TIMEOUT_MS = 8000;
const FX_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchJson(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function getHolidays(year: number, fetchFn: typeof fetch = fetch): Promise<Holiday[]> {
  const key = `holidays:${year}`;
  const cached = await db.cache.get(key);
  if (cached) return cached.value as Holiday[];
  try {
    const raw = await fetchJson(fetchFn, `https://date.nager.at/api/v3/PublicHolidays/${year}/PH`);
    if (!Array.isArray(raw)) throw new Error('bad holiday payload');
    const list: Holiday[] = raw.map((h: Holiday) => ({ date: h.date, name: h.name }));
    await putCache(key, list);
    return list;
  } catch {
    return (bundled as Record<string, Holiday[]>)[String(year)] ?? [];
  }
}

/** Network-free holidays for a year: the cached API result, else the bundled list, else []. */
async function cachedHolidays(year: number): Promise<Holiday[]> {
  const cached = await db.cache.get(`holidays:${year}`);
  if (cached) return cached.value as Holiday[];
  return (bundled as Record<string, Holiday[]>)[String(year)] ?? [];
}

/** Merges per-year lists with the Davao local days (when on) and custom dates; sorted, unique. */
function mergeHolidays(s: AppSettings, years: number[], lists: Holiday[][]): string[] {
  const out = new Set<string>();
  years.forEach((y, k) => {
    for (const h of lists[k]) out.add(h.date);
    if (s.davaoHolidays) {
      for (const d of DAVAO_LOCAL) {
        out.add(`${y}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`);
      }
    }
  });
  for (const c of s.customHolidays) out.add(c);
  return [...out].sort();
}

/** Holiday dates for `years`, fetching uncached years from Nager.Date (all years at once). */
export async function holidayDates(
  s: AppSettings,
  years: number[],
  fetchFn: typeof fetch = fetch,
): Promise<string[]> {
  const lists = await Promise.all(years.map((y) => getHolidays(y, fetchFn)));
  return mergeHolidays(s, years, lists);
}

/** Same as `holidayDates` but never touches the network: cache, then bundled list. */
export async function holidayDatesCached(s: AppSettings, years: number[]): Promise<string[]> {
  const lists = await Promise.all(years.map((y) => cachedHolidays(y)));
  return mergeHolidays(s, years, lists);
}

export async function getRate(currency: string, fetchFn: typeof fetch = fetch): Promise<FxRate | null> {
  const cur = currency.toUpperCase();
  const key = `fx:${cur}`;
  const cached = await db.cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < FX_TTL_MS) return cached.value as FxRate;
  try {
    const raw = (await fetchJson(
      fetchFn,
      `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(cur)}&symbols=PHP`,
    )) as { date?: string; rates?: { PHP?: number } };
    const php = raw?.rates?.PHP;
    if (typeof php !== 'number' || !Number.isFinite(php) || typeof raw.date !== 'string') {
      throw new Error('bad fx payload');
    }
    const rate: FxRate = { currency: cur, phpPerUnit: String(php), asOf: raw.date };
    await putCache(key, rate);
    return rate;
  } catch {
    return cached ? (cached.value as FxRate) : null;
  }
}

/** The cached rate for `currency`, however old, or null. Never touches the network. */
export async function getCachedRate(currency: string): Promise<FxRate | null> {
  const cached = await db.cache.get(`fx:${currency.toUpperCase()}`);
  return cached ? (cached.value as FxRate) : null;
}

export async function setManualRate(currency: string, phpPerUnit: string, today: string): Promise<void> {
  const cur = currency.toUpperCase();
  const rate: FxRate = { currency: cur, phpPerUnit, asOf: today };
  await putCache(`fx:${cur}`, rate);
}
