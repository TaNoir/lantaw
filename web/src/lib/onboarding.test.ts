import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { initEngineSync, project } from './engine';
import { DEFAULT_SETTINGS, type StoredItem } from './db';
import { buildInput, dueOnAsOf } from './input';
import type { EngineEvent } from './engine-types';
import { PRESETS } from './items';
import {
  QUICK_GROUPS,
  blankSweldo,
  buildSweldoItems,
  checklistRows,
  defaultThirteenth,
  firstRunWrites,
  monthlyPayCentavos,
  plainFromCentavos,
  togglePaid,
  type SweldoForm,
} from './onboarding';

const form = (over: Partial<SweldoForm> = {}): SweldoForm => ({
  ...blankSweldo('2026-11-13'),
  amount: '18,000',
  thirteenthAmount: '36000',
  ...over,
});

const build = (over: Partial<SweldoForm> = {}, ids: string[] = []) => buildSweldoItems(form(over), '2026-11-13', ids);

describe('monthly pay and the 13th month default', () => {
  it('is two paydays for kinsenas and one for monthly', () => {
    expect(monthlyPayCentavos(1_800_000, 'kinsenas30')).toBe(3_600_000);
    expect(monthlyPayCentavos(1_800_000, 'kinsenasLast')).toBe(3_600_000);
    expect(monthlyPayCentavos(3_000_050, 'monthly')).toBe(3_000_050);
  });

  it('averages weekly and every-2-weeks pay over the year, to the whole peso', () => {
    // 5,000 × 52 / 12 = 21,666.67 -> 21,667
    expect(monthlyPayCentavos(500_000, 'weekly')).toBe(2_166_700);
    // 10,000 × 26 / 12 = 21,666.67 -> 21,667
    expect(monthlyPayCentavos(1_000_000, 'everyTwoWeeks')).toBe(2_166_700);
    // 6 × 26 / 12 = 13.00
    expect(monthlyPayCentavos(600, 'everyTwoWeeks')).toBe(1300);
  });

  it('suggests one month’s pay as a plain amount, or nothing while the amount is invalid', () => {
    expect(defaultThirteenth('18,000', 'kinsenas30')).toBe('36000');
    expect(defaultThirteenth('15000.25', 'monthly')).toBe('15000.25');
    expect(defaultThirteenth('', 'monthly')).toBe('');
    expect(defaultThirteenth('abc', 'monthly')).toBe('');
  });

  it('writes centavos the way a person types them', () => {
    expect(plainFromCentavos(3_600_000)).toBe('36000');
    expect(plainFromCentavos(12_050)).toBe('120.50');
    expect(plainFromCentavos(5)).toBe('0.05');
  });
});

describe('buildSweldoItems', () => {
  it('makes the main sweldo and the 13th month, both on the working day before', () => {
    const r = build();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [sweldo, thirteenth] = r.items;
    expect(sweldo).toMatchObject({
      id: 'sweldo',
      name: 'Sweldo',
      kind: { type: 'income', mainSweldo: true },
      amount: '18000.00',
      currency: 'PHP',
      businessDay: 'previous',
      included: true,
      schedule: { start: '2026-11-01', end: null, every: { type: 'kinsenas', second: 'thirtieth' } },
    });
    expect(thirteenth).toMatchObject({
      id: '13th-month',
      name: '13th month',
      kind: { type: 'income', mainSweldo: false },
      amount: '36000.00',
      businessDay: 'previous',
      schedule: { start: '2026-11-01', end: null, every: { type: 'yearly', month: 12, day: 15 } },
    });
  });

  it('maps every schedule choice', () => {
    const every = (over: Partial<SweldoForm>) => {
      const r = build(over);
      return r.ok ? r.items[0].schedule : null;
    };
    expect(every({ schedule: 'kinsenasLast' })?.every).toEqual({ type: 'kinsenas', second: 'lastDay' });
    expect(every({ schedule: 'monthly', payDay: 25 })).toEqual({
      start: '2026-11-01',
      end: null,
      every: { type: 'monthly', day: 25 },
    });
    expect(every({ schedule: 'weekly', nextPayday: '2026-11-20' })).toEqual({
      start: '2026-11-20',
      end: null,
      every: { type: 'weekly' },
    });
    expect(every({ schedule: 'everyTwoWeeks', nextPayday: '2026-11-14' })?.every).toEqual({ type: 'everyTwoWeeks' });
  });

  it('leaves the 13th month out when it is switched off, whatever its amount', () => {
    const r = build({ thirteenth: false, thirteenthAmount: 'nonsense' });
    expect(r.ok && r.items.map((i) => i.id)).toEqual(['sweldo']);
  });

  it('keeps ids unique against existing items', () => {
    const r = build({}, ['sweldo', '13th-month']);
    expect(r.ok && r.items.map((i) => i.id)).toEqual(['sweldo-2', '13th-month-2']);
  });

  it('explains what is wrong', () => {
    const errs = (over: Partial<SweldoForm>) => {
      const r = build(over);
      return r.ok ? {} : r.errors;
    };
    expect(errs({ amount: '' }).amount).toMatch(/each payday/);
    expect(errs({ amount: '-5' }).amount).toMatch(/negative/);
    expect(errs({ amount: '0' }).amount).toMatch(/more than ₱0/);
    expect(errs({ amount: '1000000000000' }).amount).toMatch(/too large/);
    expect(errs({ schedule: 'monthly', payDay: 0 }).payDay).toBeTruthy();
    expect(errs({ schedule: 'weekly', nextPayday: '' }).nextPayday).toBeTruthy();
    expect(errs({ thirteenthAmount: '' }).thirteenthAmount).toMatch(/switch it off/);
    expect(errs({ thirteenthAmount: '0' }).thirteenthAmount).toMatch(/more than ₱0/);
    // A monthly payday is ignored for kinsenas, a next payday for monthly.
    expect(build({ payDay: 0, nextPayday: '' }).ok).toBe(true);
  });
});

describe('firstRunWrites', () => {
  const income = (id: string, main: boolean): StoredItem => ({
    id,
    name: id,
    kind: { type: 'income', mainSweldo: main },
    amount: '1000.00',
    currency: 'PHP',
    schedule: { start: '2026-11-01', end: null, every: { type: 'monthly', day: 1 } },
    businessDay: 'previous',
    included: true,
    paidFrom: null,
    createdAt: 1,
    updatedAt: 1,
  });

  it('takes the main-sweldo flag from an income added during quick add', () => {
    const r = build();
    if (!r.ok) throw new Error('form');
    const writes = firstRunWrites([income('raket', true), income('other', false)], r.items);
    expect(writes.map((i) => i.id)).toEqual(['sweldo', '13th-month', 'raket']);
    expect(writes[2].kind).toEqual({ type: 'income', mainSweldo: false });
  });

  it('writes just the sweldo items when nothing else needs to change', () => {
    const r = build();
    if (!r.ok) throw new Error('form');
    expect(firstRunWrites([income('other', false)], r.items)).toEqual(r.items);
    expect(firstRunWrites([income('raket', true)], [])).toEqual([]);
  });
});

describe('QUICK_GROUPS', () => {
  it('shows every preset exactly once', () => {
    const keys = QUICK_GROUPS.flatMap((g) => g.keys);
    expect([...keys].sort()).toEqual(Object.keys(PRESETS).sort());
  });
});

describe('checklist', () => {
  const ev = (over: Partial<EngineEvent>): EngineEvent => ({
    date: '2026-11-13',
    nominalDate: '2026-11-13',
    itemId: 'x',
    name: 'X',
    centavos: -100,
    note: null,
    included: true,
    ...over,
  });

  it('has one row per item and leaves out what-ifs', () => {
    const rows = checklistRows([
      ev({ itemId: 'sweldo', name: 'Sweldo', centavos: 1_800_000, note: 'moved from Sun Nov 15' }),
      ev({ itemId: 'spaylater', name: 'SPayLater', centavos: -125_000, note: '2 of 6' }),
      ev({ itemId: 'laptop', name: 'Laptop', included: false }),
      ev({ itemId: 'spaylater', name: 'SPayLater', centavos: -1_000, note: '3 of 6' }),
    ]);
    expect(rows).toEqual([
      { itemId: 'sweldo', name: 'Sweldo', centavos: 1_800_000, note: 'moved from Sun Nov 15' },
      { itemId: 'spaylater', name: 'SPayLater', centavos: -126_000, note: '2 of 6, 3 of 6' },
    ]);
  });

  it('ticks and unticks without duplicates', () => {
    expect(togglePaid([], 'a', true)).toEqual(['a']);
    expect(togglePaid(['a'], 'a', true)).toEqual(['a']);
    expect(togglePaid(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(togglePaid(['b'], 'a', false)).toEqual(['b']);
  });
});

describe('first run end to end (engine)', () => {
  beforeAll(() => {
    initEngineSync(readFileSync('src/lib/wasm-pkg/lantaw_engine_bg.wasm'));
  });

  it('puts a sweldo moved onto the as-of date on the checklist, and pays the 13th month in December', () => {
    const r = build();
    if (!r.ok) throw new Error('form');
    const settings = { ...DEFAULT_SETTINGS('2026-11-13'), balance: '8240.00' };
    const input = buildInput(settings, r.items, [], [], '2026-11-13');
    // Nov 15, 2026 is a Sunday: the sweldo comes on Friday the 13th, the as-of date.
    expect(checklistRows(dueOnAsOf(input))).toEqual([
      { itemId: 'sweldo', name: 'Sweldo', centavos: 1_800_000, note: 'moved from Sun Nov 15' },
    ]);
    const p = project(input);
    expect(p.events.find((e) => e.itemId === '13th-month')).toMatchObject({ date: '2026-12-15', centavos: 3_600_000 });
    expect(p.cutoffs[0].payday).toBe('2026-11-13');
  });
});
