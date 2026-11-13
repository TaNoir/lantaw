import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, DEFAULT_SETTINGS } from './db';
import { getCachedRate, getHolidays, getRate, holidayDates, refreshRate, holidayDatesCached, setManualRate } from './apis';

const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('getHolidays', () => {
  it('caches the network result', async () => {
    const f = vi.fn(async (_u: string) => json([{ date: '2026-01-01', name: 'New Year', extra: 1 }]));
    const a = await getHolidays(2026, f as unknown as typeof fetch);
    expect(a).toEqual([{ date: '2026-01-01', name: 'New Year' }]);
    const b = await getHolidays(2026, f as unknown as typeof fetch);
    expect(b).toEqual(a);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toBe('https://date.nager.at/api/v3/PublicHolidays/2026/PH');
  });

  it('falls back to bundled list on failure', async () => {
    const f = vi.fn(async () => { throw new Error('offline'); });
    const r = await getHolidays(2026, f as unknown as typeof fetch);
    expect(r.length).toBe(18);
  });

  it('returns [] for unknown year when fetch fails', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    expect(await getHolidays(2040, f as unknown as typeof fetch)).toEqual([]);
  });
});

describe('getHolidays: 30-day cache, never an empty list', () => {
  const DAY = 86_400_000;
  const cachedRow = (year: number, ageDays: number, value: unknown) =>
    db.cache.put({ key: `holidays:${year}`, value, fetchedAt: Date.now() - ageDays * DAY });

  it('uses a cached year younger than 30 days without the network', async () => {
    await cachedRow(2026, 29, [{ date: '2026-06-01', name: 'Cached' }]);
    const f = vi.fn();
    expect(await getHolidays(2026, f as unknown as typeof fetch)).toEqual([{ date: '2026-06-01', name: 'Cached' }]);
    expect(f).not.toHaveBeenCalled();
  });

  it('asks again once the cached year is older than 30 days, and replaces it', async () => {
    await cachedRow(2026, 31, [{ date: '2026-06-01', name: 'Old' }]);
    const f = vi.fn(async (_u: string) => json([{ date: '2026-06-12', name: 'New' }]));
    expect(await getHolidays(2026, f as unknown as typeof fetch)).toEqual([{ date: '2026-06-12', name: 'New' }]);
    expect(f).toHaveBeenCalledTimes(1);
    const row = await db.cache.get('holidays:2026');
    expect(row!.value).toEqual([{ date: '2026-06-12', name: 'New' }]);
    expect(Date.now() - row!.fetchedAt).toBeLessThan(DAY);
  });

  it('keeps the stale cached year when the refresh fails', async () => {
    await cachedRow(2026, 40, [{ date: '2026-06-01', name: 'Old' }]);
    const f = vi.fn(async () => { throw new Error('offline'); });
    expect(await getHolidays(2026, f as unknown as typeof fetch)).toEqual([{ date: '2026-06-01', name: 'Old' }]);
    expect((await db.cache.get('holidays:2026'))!.value).toEqual([{ date: '2026-06-01', name: 'Old' }]);
  });

  it('does not cache an empty answer; falls back to the bundled list', async () => {
    const f = vi.fn(async (_u: string) => json([]));
    expect((await getHolidays(2026, f as unknown as typeof fetch)).length).toBe(18);
    expect(await db.cache.get('holidays:2026')).toBeUndefined();
    await getHolidays(2026, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('ignores an empty list cached by an older version (asks the network, reads the bundled list)', async () => {
    await cachedRow(2026, 1, []);
    const f = vi.fn(async () => { throw new Error('offline'); });
    expect((await getHolidays(2026, f as unknown as typeof fetch)).length).toBe(18);
    expect(f).toHaveBeenCalledTimes(1);
    expect((await holidayDatesCached({ ...DEFAULT_SETTINGS('2026-01-01'), davaoHolidays: false }, [2026])).length).toBe(18);
  });

  it('cache-first reads still return a stale cached year at once', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('network must not be used');
    });
    await cachedRow(2026, 90, [{ date: '2026-06-01', name: 'Old' }]);
    expect(await holidayDatesCached({ ...DEFAULT_SETTINGS('2026-01-01'), davaoHolidays: false }, [2026])).toEqual([
      '2026-06-01',
    ]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('holidayDates', () => {
  const fail = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  it('includes Davao only when enabled and merges custom dates', async () => {
    const base = { ...DEFAULT_SETTINGS('2027-01-01'), customHolidays: ['2027-05-05', '2027-01-01'] };
    const on = await holidayDates({ ...base, davaoHolidays: true }, [2027], fail);
    const off = await holidayDates({ ...base, davaoHolidays: false }, [2027], fail);
    expect(on).toContain('2027-03-16');
    expect(off).not.toContain('2027-03-16');
    expect(on).toContain('2027-05-05');
    expect(new Set(on).size).toBe(on.length);
    expect([...on].sort()).toEqual(on);
  });
});

describe('getRate', () => {
  it('maps the Frankfurter response', async () => {
    const f = vi.fn(async (_u: string) => json({ amount: 1, base: 'USD', date: '2026-11-12', rates: { PHP: 63.727 } }));
    const r = await getRate('usd', f as unknown as typeof fetch);
    expect(r).toEqual({ currency: 'USD', phpPerUnit: '63.727', asOf: '2026-11-12' });
    expect(String(f.mock.calls[0][0])).toBe('https://api.frankfurter.dev/v1/latest?base=USD&symbols=PHP');
    await getRate('USD', f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('returns null when failed with nothing cached', async () => {
    const f = vi.fn(async () => { throw new Error('offline'); });
    expect(await getRate('USD', f as unknown as typeof fetch)).toBeNull();
  });

  it('returns stale cache on failure after 24h', async () => {
    await setManualRate('USD', '60', '2026-11-01');
    await db.cache.update('fx:USD', { fetchedAt: Date.now() - 25 * 3600_000 });
    const f = vi.fn(async () => { throw new Error('offline'); });
    expect(await getRate('USD', f as unknown as typeof fetch)).toEqual({ currency: 'USD', phpPerUnit: '60', asOf: '2026-11-01' });
  });

  it('manual rate is used while fresh', async () => {
    await setManualRate('USD', '58.5', '2026-11-13');
    const f = vi.fn();
    expect(await getRate('USD', f as unknown as typeof fetch)).toEqual({ currency: 'USD', phpPerUnit: '58.5', asOf: '2026-11-13' });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('refreshRate', () => {
  it('asks the network even while the cached rate is fresh, and caches the answer', async () => {
    await setManualRate('USD', '58.5', '2026-11-13');
    const f = vi.fn(async (_u: string) => json({ date: '2026-11-13', rates: { PHP: 63.5 } }));
    const r = await refreshRate('usd', f as unknown as typeof fetch);
    expect(r).toEqual({ rate: { currency: 'USD', phpPerUnit: '63.5', asOf: '2026-11-13' }, fresh: true });
    expect(f).toHaveBeenCalledTimes(1);
    expect(await getCachedRate('USD')).toEqual(r.rate);
  });

  it('offline: keeps and returns the cached rate, marked not fresh', async () => {
    await setManualRate('USD', '58.5', '2026-11-10');
    const f = vi.fn(async () => { throw new Error('offline'); });
    expect(await refreshRate('USD', f as unknown as typeof fetch)).toEqual({
      rate: { currency: 'USD', phpPerUnit: '58.5', asOf: '2026-11-10' },
      fresh: false,
    });
  });

  it('offline with nothing cached gives no rate', async () => {
    const f = vi.fn(async () => { throw new Error('offline'); });
    expect(await refreshRate('USD', f as unknown as typeof fetch)).toEqual({ rate: null, fresh: false });
  });
});

describe('cache-first lookups (no network)', () => {
  const noFetch = () => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('network must not be used');
  });

  it('holidayDatesCached uses the cached year, then the bundled list, then nothing', async () => {
    const spy = noFetch();
    await db.cache.put({ key: 'holidays:2027', value: [{ date: '2027-06-01', name: 'Cached day' }], fetchedAt: 1 });
    const s = { ...DEFAULT_SETTINGS('2026-11-13'), davaoHolidays: false, customHolidays: ['2040-02-02'] };
    const out = await holidayDatesCached(s, [2026, 2027, 2040]);
    expect(out).toContain('2027-06-01');
    expect(out.filter((d) => d.startsWith('2026-')).length).toBe(18);
    expect(out).toContain('2040-02-02');
    expect(out.filter((d) => d.startsWith('2040-'))).toEqual(['2040-02-02']);
    expect([...out].sort()).toEqual(out);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('holidayDatesCached adds Davao local days only when enabled', async () => {
    const spy = noFetch();
    const base = DEFAULT_SETTINGS('2027-01-01');
    expect(await holidayDatesCached({ ...base, davaoHolidays: true }, [2027])).toContain('2027-03-16');
    expect(await holidayDatesCached({ ...base, davaoHolidays: false }, [2027])).not.toContain('2027-03-16');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('getCachedRate returns a cached rate of any age, or null', async () => {
    const spy = noFetch();
    expect(await getCachedRate('usd')).toBeNull();
    await setManualRate('USD', '60', '2026-11-01');
    await db.cache.update('fx:USD', { fetchedAt: Date.now() - 30 * 86_400_000 });
    expect(await getCachedRate('usd')).toEqual({ currency: 'USD', phpPerUnit: '60', asOf: '2026-11-01' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('holidayDates network refresh', () => {
  it('requests every year at once instead of one after another', async () => {
    const pending: ((r: Response) => void)[] = [];
    const f = vi.fn((_u: string) => new Promise<Response>((res) => pending.push(res)));
    const done = holidayDates(DEFAULT_SETTINGS('2026-11-13'), [2026, 2027, 2028], f as unknown as typeof fetch);
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(3));
    for (const res of pending) res(json([]));
    await done;
  });
});
