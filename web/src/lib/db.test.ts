import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAll, db, localToday, DEFAULT_SETTINGS, deleteItem, getSettings, listItems, putItem, saveSettings } from './db';
import type { Item } from './engine-types';

const item = (id: string): Item => ({
  id,
  name: 'Rent',
  kind: { type: 'bill' },
  amount: '8000',
  currency: 'PHP',
  schedule: { start: '2026-11-01', end: null, every: { type: 'monthly', day: 1 } },
  businessDay: 'none',
  included: true,
  paidFrom: null,
});

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('storage', () => {
  it('returns defaults when empty', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS(localToday()));
    const d = DEFAULT_SETTINGS('2026-11-13');
    expect(d).toMatchObject({
      safetyBuffer: '3000', horizonMonths: 12, cardFxFeePct: '0', davaoHolidays: true,
      theme: 'system', onboarded: false, isSample: false, balance: '0', balanceAsOf: '2026-11-13',
      customHolidays: [], paidOnAsOf: [],
    });
  });

  it('round-trips settings', async () => {
    const s = { ...DEFAULT_SETTINGS('2026-11-13'), balance: '5000', theme: 'dark' as const };
    await saveSettings(s);
    expect(await getSettings()).toEqual(s);
  });

  it('round-trips items and deletes', async () => {
    await putItem(item('a'));
    const [got] = await listItems();
    expect(got).toMatchObject(item('a'));
    expect(typeof got.createdAt).toBe('number');
    await deleteItem('a');
    expect(await listItems()).toEqual([]);
  });

  it('putItem bumps updatedAt and keeps createdAt', async () => {
    await putItem(item('a'));
    const [first] = await listItems();
    await new Promise((r) => setTimeout(r, 5));
    await putItem({ ...item('a'), name: 'Rent 2' });
    const [second] = await listItems();
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.name).toBe('Rent 2');
  });

  it('clearAll empties all tables', async () => {
    await putItem(item('a'));
    await saveSettings(DEFAULT_SETTINGS('2026-11-13'));
    await db.table('cache').put({ key: 'k', value: 1, fetchedAt: 1 });
    await clearAll();
    expect(await db.table('items').count()).toBe(0);
    expect(await db.table('settings').count()).toBe(0);
    expect(await db.table('cache').count()).toBe(0);
  });
});

// Svelte 5 `$state` values are Proxies, which IndexedDB can't clone
// (DataCloneError). The storage functions must store plain copies.
describe('writes from reactive state', () => {
  it('saves Proxy-wrapped settings and items and reads them back as plain data', async () => {
    const s = { ...DEFAULT_SETTINGS('2026-11-13'), balance: '8240.00', paidOnAsOf: new Proxy(['sweldo'], {}) };
    await saveSettings(new Proxy(s, {}));
    expect(await getSettings()).toEqual({ ...s, paidOnAsOf: ['sweldo'] });

    const it1 = item('rent');
    await putItem(new Proxy({ ...it1, schedule: new Proxy({ ...it1.schedule }, {}) }, {}));
    const [back] = await listItems();
    expect(back).toMatchObject(it1);
  });
});
