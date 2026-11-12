import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, DEFAULT_SETTINGS } from './db';
import { getHolidays, getRate, holidayDates, setManualRate } from './apis';

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
