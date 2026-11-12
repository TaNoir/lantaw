import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { initEngineSync, project } from './engine';
import type { Input, Projection } from './engine-types';
import type { StoredItem } from './db';
import {
  PRESETS,
  convertToPhp,
  draftFromForm,
  duplicateItem,
  ensureMainSweldo,
  formFromItem,
  groupItems,
  itemProgress,
  itemsToSave,
  lastPaymentDate,
  newId,
  presetItem,
  rebaseSample,
  scheduleLabel,
  setMainSweldo,
  validateItem,
} from './items';
import sampleJson from './sample/sample-budget.json';

const sample = sampleJson as unknown as Input;
const stored = (): StoredItem[] => sample.items.map((it, n) => ({ ...it, createdAt: n + 1, updatedAt: n + 1 }));
const byId = (list: StoredItem[], id: string) => list.find((i) => i.id === id)!;

/** A valid monthly bill draft; each test breaks one thing. */
const bill = (over: Partial<StoredItem> = {}): Partial<StoredItem> => ({
  id: 'netflix',
  name: 'Netflix',
  kind: { type: 'bill' },
  amount: '549',
  currency: 'PHP',
  schedule: { start: '2026-11-13', end: null, every: { type: 'monthly', day: 8 } },
  businessDay: 'none',
  included: true,
  paidFrom: null,
  ...over,
});

const errorsOf = (draft: Partial<StoredItem>) => {
  const r = validateItem(draft);
  return r.ok ? {} : r.errors;
};

describe('validateItem', () => {
  it('accepts a valid item and normalises the amount', () => {
    const r = validateItem(bill({ amount: ' 1,000.5 ', name: '  Netflix ' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.item.amount).toBe('1000.50');
    expect(r.item.name).toBe('Netflix');
    expect(r.item.schedule.every).toEqual({ type: 'monthly', day: 8 });
  });

  it('amount must pass parseAmount', () => {
    expect(errorsOf(bill({ amount: '549' })).amount).toBeUndefined();
    for (const bad of ['', 'abc', '-5', '1000000000000', '1.234']) {
      expect(errorsOf(bill({ amount: bad })).amount, bad).toBeTruthy();
    }
  });

  it('name is required and at most 40 characters', () => {
    expect(errorsOf(bill({ name: 'x'.repeat(40) })).name).toBeUndefined();
    expect(errorsOf(bill({ name: '   ' })).name).toBeTruthy();
    expect(errorsOf(bill({ name: 'x'.repeat(41) })).name).toBeTruthy();
  });

  it('installment totalPayments is 1 to 120', () => {
    const inst = (n: number) => bill({ kind: { type: 'installment', totalPayments: n, paidOverride: null } });
    expect(errorsOf(inst(1)).totalPayments).toBeUndefined();
    expect(errorsOf(inst(120)).totalPayments).toBeUndefined();
    expect(errorsOf(inst(0)).totalPayments).toBeTruthy();
    expect(errorsOf(inst(121)).totalPayments).toBeTruthy();
    expect(errorsOf(inst(Number.NaN)).totalPayments).toBeTruthy();
    expect(errorsOf(inst(2.5)).totalPayments).toBeTruthy();
  });

  it('installment paidOverride is 0 to totalPayments', () => {
    const inst = (k: number | null) => bill({ kind: { type: 'installment', totalPayments: 12, paidOverride: k } });
    expect(errorsOf(inst(null)).paidOverride).toBeUndefined();
    expect(errorsOf(inst(0)).paidOverride).toBeUndefined();
    expect(errorsOf(inst(12)).paidOverride).toBeUndefined();
    expect(errorsOf(inst(13)).paidOverride).toBeTruthy();
    expect(errorsOf(inst(-1)).paidOverride).toBeTruthy();
  });

  it('paluwagan members is 2 to 50', () => {
    const pal = (m: number) => bill({ kind: { type: 'paluwagan', members: m, myTurn: 1 } });
    expect(errorsOf(pal(2)).members).toBeUndefined();
    expect(errorsOf(pal(50)).members).toBeUndefined();
    expect(errorsOf(pal(1)).members).toBeTruthy();
    expect(errorsOf(pal(51)).members).toBeTruthy();
  });

  it('paluwagan myTurn is 1 to members', () => {
    const pal = (t: number) => bill({ kind: { type: 'paluwagan', members: 10, myTurn: t } });
    expect(errorsOf(pal(1)).myTurn).toBeUndefined();
    expect(errorsOf(pal(10)).myTurn).toBeUndefined();
    expect(errorsOf(pal(0)).myTurn).toBeTruthy();
    expect(errorsOf(pal(11)).myTurn).toBeTruthy();
  });

  it('monthly day is 1 to 31', () => {
    const m = (day: number) => bill({ schedule: { start: '2026-11-13', end: null, every: { type: 'monthly', day } } });
    expect(errorsOf(m(1)).day).toBeUndefined();
    expect(errorsOf(m(31)).day).toBeUndefined();
    expect(errorsOf(m(0)).day).toBeTruthy();
    expect(errorsOf(m(32)).day).toBeTruthy();
  });

  it('yearly is a valid month and day, Feb 29 allowed', () => {
    const y = (month: number, day: number) =>
      bill({ schedule: { start: '2026-11-13', end: null, every: { type: 'yearly', month, day } } });
    expect(errorsOf(y(2, 29))).toEqual({});
    expect(errorsOf(y(12, 15))).toEqual({});
    expect(errorsOf(y(2, 30)).day).toBeTruthy();
    expect(errorsOf(y(4, 31)).day).toBeTruthy();
    expect(errorsOf(y(13, 1)).month).toBeTruthy();
    expect(errorsOf(y(0, 1)).month).toBeTruthy();
  });

  it('end, if set, is on or after start', () => {
    const e = (end: string | null) => bill({ schedule: { start: '2026-11-13', end, every: { type: 'monthly', day: 8 } } });
    expect(errorsOf(e(null)).end).toBeUndefined();
    expect(errorsOf(e('2026-11-13')).end).toBeUndefined();
    expect(errorsOf(e('2027-06-30')).end).toBeUndefined();
    expect(errorsOf(e('2026-11-12')).end).toBeTruthy();
    expect(errorsOf(e('not-a-date')).end).toBeTruthy();
  });

  it('needs a real start date', () => {
    expect(errorsOf(bill({ schedule: { start: '', end: null, every: { type: 'monthly', day: 8 } } })).start).toBeTruthy();
    expect(errorsOf(bill({ schedule: { start: '2026-02-30', end: null, every: { type: 'monthly', day: 8 } } })).start).toBeTruthy();
  });

  it('currency is PHP or a 3-letter upper-case code', () => {
    expect(errorsOf(bill({ currency: 'PHP' })).currency).toBeUndefined();
    expect(errorsOf(bill({ currency: 'USD' })).currency).toBeUndefined();
    expect(errorsOf(bill({ currency: 'usd' })).currency).toBeTruthy();
    expect(errorsOf(bill({ currency: 'US' })).currency).toBeTruthy();
    expect(errorsOf(bill({ currency: 'PESO' })).currency).toBeTruthy();
  });

  it('every message is a sentence for people, not a code', () => {
    const errs = errorsOf(bill({ name: '', amount: 'abc', currency: 'x' }));
    expect(Object.keys(errs).sort()).toEqual(['amount', 'currency', 'name']);
    for (const msg of Object.values(errs)) expect(msg).toMatch(/^[A-Z].*\.$/);
  });

  it('drops the end date of a one-time item', () => {
    const r = validateItem(bill({ schedule: { start: '2026-12-20', end: '2027-01-01', every: { type: 'once' } } }));
    expect(r.ok && r.item.schedule.end).toBe(null);
  });
});

describe('setMainSweldo', () => {
  it('moves the flag so exactly one income is the main sweldo', () => {
    const before = stored();
    const after = setMainSweldo(before, '13th-month');
    const mains = after.filter((i) => i.kind.type === 'income' && i.kind.mainSweldo);
    expect(mains.map((i) => i.id)).toEqual(['13th-month']);
    // Untouched items keep their identity, so only changed ones are saved.
    expect(byId(after, 'rent')).toBe(byId(before, 'rent'));
    // And the input is not mutated.
    expect(byId(before, 'sweldo').kind).toEqual({ type: 'income', mainSweldo: true });
  });

  it('ignores an id that is not an income', () => {
    const before = stored();
    expect(setMainSweldo(before, 'rent')).toEqual(before);
  });
});

describe('ensureMainSweldo', () => {
  it('promotes the earliest income when the main sweldo is deleted', () => {
    const left = stored().filter((i) => i.id !== 'sweldo');
    const out = ensureMainSweldo(left);
    expect(out.map((i) => i.id)).toEqual(['13th-month']);
    expect(out[0].kind).toEqual({ type: 'income', mainSweldo: true });
  });

  it('picks by createdAt, not list order', () => {
    const left = stored().filter((i) => i.id !== 'sweldo');
    const late: StoredItem = { ...byId(left, '13th-month'), id: 'raket', createdAt: 0, kind: { type: 'income', mainSweldo: false } };
    expect(ensureMainSweldo([...left, late]).map((i) => i.id)).toEqual(['raket']);
  });

  it('changes nothing when one main exists or there is no income', () => {
    expect(ensureMainSweldo(stored())).toEqual([]);
    expect(ensureMainSweldo(stored().filter((i) => i.kind.type !== 'income'))).toEqual([]);
  });

  it('keeps only the earliest when several are flagged', () => {
    const list = stored().map((i) => (i.id === '13th-month' ? { ...i, kind: { type: 'income' as const, mainSweldo: true } } : i));
    expect(ensureMainSweldo(list).map((i) => [i.id, i.kind])).toEqual([['13th-month', { type: 'income', mainSweldo: false }]]);
  });
});

describe('itemsToSave', () => {
  it('promotes another income when the main sweldo becomes a bill', () => {
    const list = stored();
    const nowBill: StoredItem = { ...byId(list, 'sweldo'), kind: { type: 'bill' } };
    const out = itemsToSave(list, nowBill);
    expect(out.map((i) => i.id).sort()).toEqual(['13th-month', 'sweldo']);
    expect(byId(out, '13th-month').kind).toEqual({ type: 'income', mainSweldo: true });
    expect(byId(out, 'sweldo').kind).toEqual({ type: 'bill' });
  });

  it('saves a new main sweldo plus the income that lost the flag', () => {
    const list = stored();
    const side: StoredItem = { ...byId(list, '13th-month'), id: 'raket', name: 'Raket', kind: { type: 'income', mainSweldo: true } };
    const out = itemsToSave(list, side);
    expect(out.map((i) => i.id).sort()).toEqual(['raket', 'sweldo']);
    expect(byId(out, 'sweldo').kind).toEqual({ type: 'income', mainSweldo: false });
  });

  it('makes the only income the main sweldo', () => {
    const solo: StoredItem = { ...byId(stored(), 'sweldo'), kind: { type: 'income', mainSweldo: false } };
    const out = itemsToSave([], solo);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toEqual({ type: 'income', mainSweldo: true });
  });

  it('saves just the item when nothing else changes', () => {
    const rent = { ...byId(stored(), 'rent'), amount: '7500.00' };
    expect(itemsToSave(stored(), rent)).toEqual([rent]);
  });
});

describe('newId', () => {
  it('kebab-cases the name', () => {
    expect(newId('Davao Light', [])).toBe('davao-light');
    expect(newId('BPI 0% laptop', [])).toBe('bpi-0-laptop');
    expect(newId('  Piñata!! ', [])).toBe('pinata');
    expect(newId('!!!', [])).toBe('item');
  });

  it('appends -2, -3 on a clash', () => {
    expect(newId('Davao Light', ['davao-light'])).toBe('davao-light-2');
    expect(newId('Davao Light', ['davao-light', 'davao-light-2'])).toBe('davao-light-3');
  });
});

describe('duplicateItem', () => {
  it('copies with "(copy)" and a new id, never as the main sweldo', () => {
    const list = stored();
    const copy = duplicateItem(byId(list, 'sweldo'), list.map((i) => i.id));
    expect(copy.name).toBe('Sweldo (copy)');
    expect(copy.id).toBe('sweldo-copy');
    expect(copy.kind).toEqual({ type: 'income', mainSweldo: false });
    expect(validateItem(copy).ok).toBe(true);
  });

  it('copies the values it is given (the open form), with no write to the original', () => {
    const edited = { ...byId(stored(), 'rent'), amount: '7500.00' };
    const copy = duplicateItem(edited, stored().map((i) => i.id));
    expect(copy.amount).toBe('7500.00');
    expect(copy.id).toBe('rent-copy');
    // Saving the copy through itemsToSave never touches the stored rent.
    expect(itemsToSave(stored(), copy).map((i) => i.id)).toEqual(['rent-copy']);
  });

  it('keeps a long name within 40 characters', () => {
    const long = { ...byId(stored(), 'rent'), name: 'x'.repeat(40) };
    expect(duplicateItem(long, []).name.length).toBeLessThanOrEqual(40);
  });
});

describe('PRESETS', () => {
  it('has the quick-add amounts and days', () => {
    const amt = (k: string) => PRESETS[k].amount;
    const day = (k: string) => {
      const e = PRESETS[k].schedule?.every;
      return e?.type === 'monthly' ? e.day : undefined;
    };
    expect([amt('Davao Light'), day('Davao Light')]).toEqual(['1850', 15]);
    expect([amt('DCWD'), day('DCWD')]).toEqual(['420', 20]);
    expect([amt('Internet'), day('Internet')]).toEqual(['1500', 5]);
    expect([amt('Postpaid'), day('Postpaid')]).toEqual(['999', 13]);
    expect([amt('Netflix'), day('Netflix')]).toEqual(['549', 8]);
    expect([amt('Spotify'), day('Spotify')]).toEqual(['194', 10]);
    expect([amt('ChatGPT'), day('ChatGPT'), PRESETS.ChatGPT.currency]).toEqual(['20', 22, 'USD']);
    expect([amt('YouTube'), day('YouTube')]).toEqual(['179', 12]);
  });

  it('has the installment and paluwagan defaults', () => {
    const total = (k: string) => {
      const kind = PRESETS[k].kind;
      return kind?.type === 'installment' ? kind.totalPayments : undefined;
    };
    expect(total('Home Credit')).toBe(12);
    expect(total('SPayLater')).toBe(6);
    expect(total('GGives')).toBe(6);
    expect(total('Card 0%')).toBe(12);
    expect(PRESETS.Paluwagan.kind).toEqual({ type: 'paluwagan', members: 10, myTurn: 1 });
  });

  it('starts today, and every preset validates once an amount is filled in', () => {
    for (const key of Object.keys(PRESETS)) {
      const p = presetItem(key, '2026-11-13');
      expect(p.schedule?.start, key).toBe('2026-11-13');
      const r = validateItem({ ...p, id: newId(p.name ?? '', []), amount: p.amount || '1000' });
      expect(r.ok, key).toBe(true);
    }
  });

  it('runs installments on the day of month they start', () => {
    expect(presetItem('Home Credit', '2026-11-13').schedule?.every).toEqual({ type: 'monthly', day: 13 });
  });
});

describe('rebaseSample', () => {
  it('moves the sample to today', () => {
    const { settings, items } = rebaseSample(sample, '2027-02-13');
    expect(settings.balanceAsOf).toBe('2027-02-13');
    expect(settings.isSample).toBe(true);
    expect(byId(items, 'home-credit-phone').schedule.start).toBe('2026-12-15');
    expect(byId(items, 'sweldo').schedule.start).toBe('2027-02-01');
    // Yearly items keep their month and day.
    expect(byId(items, '13th-month').schedule.every).toEqual({ type: 'yearly', month: 12, day: 15 });
    expect(items.every((i) => i.createdAt > 0)).toBe(true);
  });

  it('clamps to the end of a shorter month and shifts end dates and custom holidays', () => {
    const s: Input = {
      ...sample,
      settings: { ...sample.settings, balanceAsOf: '2027-01-31', customHolidays: ['2027-01-31'] } as Input['settings'],
      items: [{ ...sample.items[2], schedule: { start: '2027-01-31', end: '2028-01-31', every: { type: 'monthly', day: 31 } } }],
    };
    const { settings, items } = rebaseSample(s, '2027-02-10');
    expect(items[0].schedule.start).toBe('2027-02-28');
    expect(items[0].schedule.end).toBe('2028-02-29');
    expect(settings.customHolidays).toEqual(['2027-02-28']);
    expect(settings.balanceAsOf).toBe('2027-02-10');
  });

  it('leaves the fixture alone on its own as-of date', () => {
    const { items } = rebaseSample(sample, '2026-11-13');
    expect(items.map((i) => i.schedule)).toEqual(sample.items.map((i) => i.schedule));
  });
});

describe('form round trip', () => {
  it('turns an item into a form and back', () => {
    for (const it of stored()) {
      const r = validateItem(draftFromForm(formFromItem(it, '2026-11-13')));
      expect(r.ok, it.id).toBe(true);
      if (!r.ok) continue;
      expect({ ...r.item, amount: it.amount }).toEqual({ ...it, amount: it.amount });
    }
  });

  it('treats blank number fields as missing, not zero', () => {
    const f = formFromItem(byId(stored(), 'spaylater'), '2026-11-13');
    expect(errorsOf(draftFromForm({ ...f, totalPayments: '' })).totalPayments).toBeTruthy();
    expect(errorsOf(draftFromForm({ ...f, paidOverride: '' }))).toEqual({});
  });
});

describe('row helpers', () => {
  let proj: Projection;
  beforeAll(() => {
    initEngineSync(readFileSync('src/lib/wasm-pkg/lantaw_engine_bg.wasm'));
    proj = project(sample);
  });

  it('shows "k of n · ends Mon YYYY" for hulog', () => {
    const list = stored();
    expect(itemProgress(proj, byId(list, 'home-credit-phone'))).toBe('3 of 12 · ends Aug 2027');
    expect(itemProgress(proj, byId(list, 'spaylater'))).toBe('2 of 6 · ends Mar 2027');
    expect(itemProgress(proj, byId(list, 'rent'))).toBe(null);
  });

  it('works out the end of a monthly hulog that runs past the forecast', () => {
    // BPI 0% laptop: Jan 3 2027 x 12; the 12-month window stops after payment 11.
    expect(itemProgress(proj, byId(stored(), 'bpi-0-laptop'))).toBe('1 of 12 · ends Dec 2027');
  });

  it('finds the last nominal payment date', () => {
    const sch = (start: string, every: StoredItem['schedule']['every'], end: string | null = null) => ({ start, end, every });
    expect(lastPaymentDate(sch('2027-01-31', { type: 'monthly', day: 31 }), 2)).toBe('2027-02-28');
    expect(lastPaymentDate(sch('2026-09-15', { type: 'monthly', day: 15 }), 12)).toBe('2027-08-15');
    expect(lastPaymentDate(sch('2027-02-20', { type: 'kinsenas', second: 'thirtieth' }), 3)).toBe('2027-03-30');
    expect(lastPaymentDate(sch('2027-01-01', { type: 'weekly' }), 3)).toBe('2027-01-15');
    expect(lastPaymentDate(sch('2027-01-15', { type: 'monthly', day: 15 }, '2027-02-01'), 3)).toBe(null);
  });

  it('never claims "paid off" without a forecast', () => {
    expect(itemProgress(null, byId(stored(), 'home-credit-phone'))).toBe('12 payments');
  });

  it('stays neutral for a what-if hulog with no events', () => {
    const whatIf = { ...byId(stored(), 'spaylater'), id: 'ghost', included: false };
    expect(itemProgress(proj, whatIf)).toBe('6 payments');
  });

  it('says "paid off" only when the last payment is before the forecast', () => {
    const old = { ...byId(stored(), 'spaylater'), id: 'old', schedule: { start: '2025-01-13', end: null, every: { type: 'monthly' as const, day: 13 } } };
    expect(itemProgress(proj, old)).toBe('6 of 6 · paid off');
    const later = { ...old, id: 'later', schedule: { ...old.schedule, start: '2028-03-13' } };
    expect(itemProgress(proj, later)).toBe('6 payments · starts Mar 2028');
    const done = { ...old, id: 'done', schedule: { ...old.schedule, start: '2026-11-13' }, kind: { type: 'installment' as const, totalPayments: 6, paidOverride: 6 } };
    expect(itemProgress(proj, done)).toBe('6 of 6 · paid off');
  });

  it('shows the paluwagan turn and payout', () => {
    expect(itemProgress(proj, byId(stored(), 'paluwagan'))).toBe('turn 4 of 10 · payout May 2027');
  });

  it('labels schedules in plain words', () => {
    const s = (every: StoredItem['schedule']['every'], start = '2026-11-13') => scheduleLabel({ start, end: null, every });
    expect(s({ type: 'kinsenas', second: 'thirtieth' })).toBe('kinsenas 15 & 30');
    expect(s({ type: 'kinsenas', second: 'lastDay' })).toBe('kinsenas 15 & last day');
    expect(s({ type: 'monthly', day: 22 })).toBe('monthly 22nd');
    expect(s({ type: 'yearly', month: 12, day: 15 })).toBe('every Dec 15');
    expect(s({ type: 'weekly' })).toBe('weekly on Fri');
    expect(s({ type: 'everyTwoWeeks' })).toBe('every 2 weeks on Fri');
    expect(s({ type: 'once' }, '2026-12-20')).toBe('Dec 20, 2026');
  });

  it('converts foreign amounts like the engine (amount × rate × (1 + fee))', () => {
    expect(convertToPhp('20', '63.727', '0')).toBe(127454);
    expect(convertToPhp('20.00', '63.727', '3')).toBe(131278);
    expect(convertToPhp('abc', '63.727', '0')).toBe(null);
  });

  it('groups items in the screen order', () => {
    const groups = groupItems(stored());
    expect(groups.map((g) => g.title)).toEqual([
      'Sweldo & income',
      'Hulog',
      'Paluwagan',
      'Bills & subscriptions',
      'One-off',
    ]);
    expect(groups[1].items.map((i) => i.id)).toEqual(['home-credit-phone', 'spaylater', 'bpi-0-laptop']);
  });
});
