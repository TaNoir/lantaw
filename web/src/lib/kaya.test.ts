import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { comparePurchase, initEngineSync, project } from './engine';
import type { Input, OptionResult } from './engine-types';
import {
  MONTHS_MAX,
  belowLine,
  bestReason,
  buildPurchase,
  dateWindow,
  emptyForm,
  planTotalNote,
  optionKey,
  optionTitle,
  planDraft,
  verdictLabel,
  type KayaForm,
} from './kaya';
import { centavosToDecimal } from './money';
import { validateItem } from './items';
import sampleJson from './sample/sample-budget.json';

const sample = sampleJson as unknown as Input;

beforeAll(() => {
  initEngineSync(readFileSync('src/lib/wasm-pkg/lantaw_engine_bg.wasm'));
});

const WIN = { today: '2026-11-13', first: '2026-11-13', last: '2027-11-12', horizonMonths: 12 };

const form = (over: Partial<KayaForm> = {}): KayaForm => ({
  name: 'Inverter aircon',
  price: '28,990',
  date: '2026-11-13',
  rows: [],
  ...over,
});

const result = (over: Partial<OptionResult> = {}): OptionResult => ({
  label: 'Cash on Nov 13',
  option: { type: 'cash' },
  verdict: 'gipit',
  lowest: { date: '2027-02-28', centavos: -1036000, causes: [] },
  daysBelowBuffer: 0,
  daysBelowZero: 0,
  totalPaidCentavos: 2899000,
  addOnCentavos: 0,
  monthlyCentavos: null,
  ...over,
});

describe('centavosToDecimal', () => {
  it('writes integer centavos as a 2-dp decimal string', () => {
    expect(centavosToDecimal(289900)).toBe('2899.00');
    expect(centavosToDecimal(483167)).toBe('4831.67');
    expect(centavosToDecimal(5)).toBe('0.05');
    expect(centavosToDecimal(0)).toBe('0.00');
    expect(centavosToDecimal(-125050)).toBe('-1250.50');
  });
});

describe('dateWindow', () => {
  it('runs from today (or the forecast start, if later) to the last forecast day', () => {
    const p = project(sample);
    expect(dateWindow(p, '2026-11-13', 12)).toEqual(WIN);
    expect(dateWindow(p, '2026-11-01', 12).first).toBe('2026-11-13');
    expect(dateWindow(p, '2026-12-01', 24)).toEqual({ ...WIN, today: '2026-12-01', first: '2026-12-01', horizonMonths: 24 });
  });
});

describe('buildPurchase', () => {
  it('builds cash plus installments: blank monthly means 0% (null)', () => {
    const c = buildPurchase(
      form({
        rows: [
          { id: 1, months: '6', monthly: '' },
          { id: 2, months: ' 12 ', monthly: '2,899' },
        ],
      }),
      WIN,
    );
    expect(c.empty).toBe(false);
    expect(c.errors).toEqual({ rows: {} });
    expect(c.purchase).toEqual({
      name: 'Inverter aircon',
      price: '28990.00',
      date: '2026-11-13',
      options: [
        { type: 'cash' },
        { type: 'installment', months: 6, monthly: null },
        { type: 'installment', months: 12, monthly: '2899.00' },
      ],
    });
  });

  it('a blank price is empty, not an error', () => {
    const c = buildPurchase(form({ price: '  ' }), WIN);
    expect(c.empty).toBe(true);
    expect(c.purchase).toBeNull();
    expect(c.errors.price).toBeUndefined();
  });

  it('rejects a bad, zero or huge price with a message', () => {
    expect(buildPurchase(form({ price: 'abc' }), WIN).errors.price).toBe('Use numbers only, like 1,250.50.');
    expect(buildPurchase(form({ price: '-5' }), WIN).errors.price).toBe('Amount can’t be negative.');
    expect(buildPurchase(form({ price: '0' }), WIN).errors.price).toBe('The price must be more than ₱0.');
    expect(buildPurchase(form({ price: '1000000000000' }), WIN).errors.price).toBe('That amount is too large.');
    expect(buildPurchase(form({ price: 'abc' }), WIN).purchase).toBeNull();
  });

  it('keeps the date inside the forecast', () => {
    expect(buildPurchase(form({ date: '' }), WIN).errors.date).toBe('Pick a date.');
    expect(buildPurchase(form({ date: '2026-11-12' }), WIN).errors.date).toBe('Pick today or a later date.');
    expect(buildPurchase(form({ date: '2027-11-13' }), WIN).errors.date).toBe(
      'Pick a date within your 12-month forecast.',
    );
    expect(buildPurchase(form({ date: '2027-11-13' }), { ...WIN, horizonMonths: 24 }).errors.date).toBe(
      'Pick a date within your 24-month forecast.',
    );
    expect(buildPurchase(form({ date: '2027-11-12' }), WIN).purchase?.date).toBe('2027-11-12');
    expect(buildPurchase(form({ date: '2027-11-13' }), WIN).purchase).toBeNull();
  });

  it('flags bad installment rows and leaves them out, but still compares the rest', () => {
    const c = buildPurchase(
      form({
        rows: [
          { id: 1, months: '0', monthly: '' },
          { id: 2, months: '61', monthly: '' },
          { id: 3, months: '', monthly: '' },
          { id: 4, months: '2.5', monthly: '' },
          { id: 5, months: '6', monthly: 'abc' },
          { id: 6, months: '6', monthly: '0' },
          { id: 7, months: '3', monthly: '' },
        ],
      }),
      WIN,
    );
    expect(c.errors.rows).toEqual({
      1: { months: `Use 1 to ${MONTHS_MAX} months.` },
      2: { months: `Use 1 to ${MONTHS_MAX} months.` },
      3: { months: 'Enter the number of months.' },
      4: { months: `Use 1 to ${MONTHS_MAX} months.` },
      5: { monthly: 'Use numbers only, like 1,250.50.' },
      6: { monthly: 'Enter more than ₱0, or leave it blank for 0%.' },
    });
    expect(c.purchase?.options).toEqual([{ type: 'cash' }, { type: 'installment', months: 3, monthly: null }]);
  });

  it('drops a repeated option (same months and monthly) so each card is unique', () => {
    const c = buildPurchase(
      form({
        rows: [
          { id: 1, months: '6', monthly: '' },
          { id: 2, months: '6', monthly: '' },
          { id: 3, months: '12', monthly: '2899' },
          { id: 4, months: '12', monthly: '2,899.00' },
        ],
      }),
      WIN,
    );
    expect(c.purchase?.options).toHaveLength(3);
    expect(c.errors.rows).toEqual({});
  });

  it('a blank name still compares (as "Purchase")', () => {
    expect(buildPurchase(form({ name: '   ' }), WIN).purchase?.name).toBe('Purchase');
    expect(buildPurchase(form({ name: '  Aircon ' }), WIN).purchase?.name).toBe('Aircon');
  });
});

describe('optionKey', () => {
  it('is stable across decimal spellings', () => {
    expect(optionKey({ type: 'cash' })).toBe('cash');
    expect(optionKey({ type: 'installment', months: 6, monthly: null })).toBe('i6');
    expect(optionKey({ type: 'installment', months: 12, monthly: '2899' })).toBe(
      optionKey({ type: 'installment', months: 12, monthly: '2899.00' }),
    );
    expect(optionKey({ type: 'installment', months: 12, monthly: '2899' })).not.toBe('i12');
  });
});

describe('labels', () => {
  it('names verdicts in words', () => {
    expect(verdictLabel('kaya')).toBe('Kaya');
    expect(verdictLabel('gipit')).toBe('Gipit');
    expect(verdictLabel('hindiKaya')).toBe('Hindi kaya');
  });

  it('titles each option', () => {
    expect(optionTitle(result(), '2026-11-13', '2026-11-13')).toBe('Cash today');
    expect(optionTitle(result(), '2026-12-15', '2026-11-13')).toBe('Cash on Dec 15');
    expect(optionTitle(result(), '2027-01-15', '2026-11-13')).toBe('Cash on Jan 15, 2027');
    const zero = result({ option: { type: 'installment', months: 6, monthly: null }, monthlyCentavos: 483167 });
    expect(optionTitle(zero, '2026-11-13', '2026-11-13')).toBe('0% · 6 × ₱4,831.67');
    const hc = result({
      option: { type: 'installment', months: 12, monthly: '2899.00' },
      monthlyCentavos: 289900,
      addOnCentavos: 579800,
    });
    expect(optionTitle(hc, '2026-11-13', '2026-11-13')).toBe('12 × ₱2,899');
  });

  it('says how long the balance stays low', () => {
    const buf = 300000;
    expect(belowLine(result(), buf)).toBe('Never below your ₱3,000 buffer');
    expect(belowLine(result({ daysBelowBuffer: 1 }), buf)).toBe('1 day below your ₱3,000 buffer');
    expect(belowLine(result({ daysBelowBuffer: 12 }), buf)).toBe('12 days below your ₱3,000 buffer');
    expect(belowLine(result({ daysBelowBuffer: 40, daysBelowZero: 1 }), buf)).toBe(
      '40 days below your ₱3,000 buffer · 1 day below ₱0',
    );
    expect(belowLine(result({ daysBelowBuffer: 40, daysBelowZero: 31 }), buf)).toBe(
      '40 days below your ₱3,000 buffer · 31 days below ₱0',
    );
  });

  it('explains the best date', () => {
    expect(bestReason('right after your Paluwagan', 300000)).toBe('Right after your Paluwagan');
    expect(bestReason(null, 300000)).toBe('You stay above your ₱3,000 buffer from that day on');
  });
});

describe('planDraft', () => {
  const ids = ['sweldo', 'inverter-aircon'];

  it('cash becomes a one-time outflow on its date, real or what-if', () => {
    const d = planDraft({
      name: ' Inverter aircon ',
      price: '28990.00',
      date: '2027-05-16',
      option: { type: 'cash' },
      monthlyCentavos: null,
      included: false,
      existingIds: ids,
    });
    const v = validateItem(d);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.item).toMatchObject({
      id: 'inverter-aircon-2',
      name: 'Inverter aircon',
      kind: { type: 'oneOff', direction: 'out' },
      amount: '28990.00',
      currency: 'PHP',
      schedule: { start: '2027-05-16', end: null, every: { type: 'once' } },
      businessDay: 'none',
      included: false,
      paidFrom: null,
    });
  });

  it('an installment pays monthly from one month after the purchase, like the engine', () => {
    const d = planDraft({
      name: 'Aircon',
      price: '28990.00',
      date: '2027-01-31',
      option: { type: 'installment', months: 6, monthly: null },
      monthlyCentavos: 483167,
      included: true,
      existingIds: ids,
    });
    const v = validateItem(d);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.item).toMatchObject({
      id: 'aircon',
      name: 'Aircon',
      kind: { type: 'installment', totalPayments: 6, paidOverride: null },
      amount: '4831.67',
      schedule: { start: '2027-02-28', end: null, every: { type: 'monthly', day: 31 } },
      businessDay: 'none',
      included: true,
    });
  });

  it('a blank name fails validation (the screen asks for one)', () => {
    const d = planDraft({
      name: '  ',
      price: '100.00',
      date: '2026-11-13',
      option: { type: 'cash' },
      monthlyCentavos: null,
      included: true,
      existingIds: [],
    });
    const v = validateItem(d);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.name).toBe('Give it a name.');
  });
});

describe('the sample aircon (Task 17 hand check)', () => {
  it('every option today is Gipit or Hindi kaya, and a best cash date has a reason', () => {
    const p = project(sample);
    const c = buildPurchase(
      form({
        rows: [
          { id: 1, months: '6', monthly: '' },
          { id: 2, months: '12', monthly: '2,899' },
        ],
      }),
      dateWindow(p, sample.today, 12),
    );
    const cmp = comparePurchase(sample, c.purchase!);
    expect(cmp.options).toHaveLength(3);
    for (const r of cmp.options) expect(['gipit', 'hindiKaya']).toContain(r.verdict);
    expect(cmp.bestCashDate).not.toBeNull();
    expect(cmp.bestCashDate!.reason).toMatch(/^right after your /);

    // The planned items replay the engine's numbers.
    const inst = cmp.options.find((r) => optionKey(r.option) === 'i6')!;
    const v = validateItem(
      planDraft({
        name: 'Inverter aircon',
        price: c.purchase!.price,
        date: c.purchase!.date,
        option: inst.option,
        monthlyCentavos: inst.monthlyCentavos,
        included: true,
        existingIds: sample.items.map((i) => i.id),
      }),
    );
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const withItem = project({ ...sample, items: [...sample.items, v.item] });
    const low = Math.min(...withItem.days);
    // Same low point, give or take the 0% rounding remainder (≤ 5 centavos here).
    expect(Math.abs(low - inst.lowest.centavos)).toBeLessThanOrEqual(5);
  });
});

describe('emptyForm', () => {
  it('is a blank purchase on today, with no installment rows', () => {
    expect(emptyForm('2026-11-20')).toEqual({ name: '', price: '', date: '2026-11-20', rows: [] });
  });
});

describe('planTotalNote', () => {
  it('discloses a 0% plan whose rounded monthly does not add up to the price', () => {
    expect(planTotalNote(483167, 6, 2899000)).toBe(
      '6 × ₱4,831.67 = ₱28,990.02 (₱0.02 more than the price because of rounding)',
    );
    // 10,000 / 3 -> 3,333.33 × 3 = 9,999.99
    expect(planTotalNote(333333, 3, 1000000)).toBe(
      '3 × ₱3,333.33 = ₱9,999.99 (₱0.01 less than the price because of rounding)',
    );
  });

  it('says nothing when the payments add up exactly', () => {
    expect(planTotalNote(400000, 3, 1200000)).toBeNull();
    // A quoted monthly: the engine total is months × monthly, so no drift.
    expect(planTotalNote(289900, 12, 3478800)).toBeNull();
  });
});
