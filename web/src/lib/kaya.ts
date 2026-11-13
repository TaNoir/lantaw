// Kaya ba? ("Can I afford it?"): turning the form into an engine `Purchase`,
// the words on the verdict cards, and the item "Add to plan" creates.
// Pure functions, no state.

import type { StoredItem } from './db';
import type { OptionResult, PayOption, Projection, Purchase, Verdict } from './engine-types';
import { addDays, formatShort, yearOf } from './dates';
import { centavosToDecimal, formatPeso, parseAmount, toCentavos } from './money';
import { isIsoDate, newId, shiftMonths } from './items';

/** Longest installment the form accepts. */
export const MONTHS_MAX = 60;

/** One "+ Installment" row as typed. `id` is only for keying the row in the form. */
export interface InstallmentRow {
  id: number;
  months: string;
  /** Blank means 0%: the engine splits the price evenly. */
  monthly: string;
}

export interface KayaForm {
  name: string;
  price: string;
  date: string;
  rows: InstallmentRow[];
}

/** The dates a purchase may fall on: today (or the forecast start) to the last forecast day. */
export interface DateWindow {
  today: string;
  first: string;
  last: string;
  horizonMonths: number;
}

export interface RowErrors {
  months?: string;
  monthly?: string;
}

export interface PurchaseCheck {
  /** Ready for `comparePurchase`, or null while the price or date can't be used. */
  purchase: Purchase | null;
  /** No price typed yet (nothing to compare, and nothing to complain about). */
  empty: boolean;
  errors: { price?: string; date?: string; rows: Record<number, RowErrors> };
}

/** A blank form on `today` (after a purchase is added to the plan as a real item). */
export function emptyForm(today: string): KayaForm {
  return { name: '', price: '', date: today, rows: [] };
}

export function dateWindow(p: Projection, today: string, horizonMonths: number): DateWindow {
  return {
    today,
    first: today > p.start ? today : p.start,
    last: addDays(p.start, Math.max(0, p.days.length - 1)),
    horizonMonths,
  };
}

/** Same option, same key: cash, `i6` (0%), `i12x289900` (quoted monthly, in centavos). */
export function optionKey(o: PayOption): string {
  if (o.type === 'cash') return 'cash';
  return o.monthly === null ? `i${o.months}` : `i${o.months}x${toCentavos(o.monthly)}`;
}

/**
 * Checks the form. Cash is always an option; an installment row with a
 * problem gets a message and is left out, so the other options still compare.
 * A repeated option is dropped (it would only repeat a card).
 */
export function buildPurchase(form: KayaForm, win: DateWindow): PurchaseCheck {
  const errors: PurchaseCheck['errors'] = { rows: {} };

  let price: string | null = null;
  const empty = form.price.trim() === '';
  if (!empty) {
    const r = parseAmount(form.price);
    if (!r.ok) errors.price = r.error;
    else if (toCentavos(r.value) <= 0) errors.price = 'The price must be more than ₱0.';
    else price = r.value;
  }

  const date = form.date.trim();
  if (!isIsoDate(date)) errors.date = 'Pick a date.';
  else if (date < win.first) errors.date = 'Pick today or a later date.';
  else if (date > win.last) errors.date = `Pick a date within your ${win.horizonMonths}-month forecast.`;

  const options: PayOption[] = [{ type: 'cash' }];
  const seen = new Set(['cash']);
  for (const row of form.rows) {
    const e: RowErrors = {};
    const m = row.months.trim();
    let months = 0;
    if (m === '') e.months = 'Enter the number of months.';
    else if (!/^\d+$/.test(m) || Number(m) < 1 || Number(m) > MONTHS_MAX) e.months = `Use 1 to ${MONTHS_MAX} months.`;
    else months = Number(m);

    let monthly: string | null = null;
    if (row.monthly.trim() !== '') {
      const r = parseAmount(row.monthly);
      if (!r.ok) e.monthly = r.error;
      else if (toCentavos(r.value) <= 0) e.monthly = 'Enter more than ₱0, or leave it blank for 0%.';
      else monthly = r.value;
    }

    if (e.months || e.monthly) {
      errors.rows[row.id] = e;
      continue;
    }
    const opt: PayOption = { type: 'installment', months, monthly };
    const key = optionKey(opt);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(opt);
  }

  const ok = price !== null && !errors.date;
  return {
    purchase: ok ? { name: form.name.trim() || 'Purchase', price: price!, date, options } : null,
    empty,
    errors,
  };
}

// ---------------------------------------------------------------- words

const VERDICTS: Record<Verdict, string> = { kaya: 'Kaya', gipit: 'Gipit', hindiKaya: 'Hindi kaya' };

export function verdictLabel(v: Verdict): string {
  return VERDICTS[v];
}

/** "Cash today", "Cash on Dec 15", "0% · 6 × ₱4,831.67", "12 × ₱2,899". */
export function optionTitle(r: OptionResult, purchaseDate: string, today: string): string {
  const o = r.option;
  if (o.type === 'cash') {
    return purchaseDate === today ? 'Cash today' : `Cash on ${formatShort(purchaseDate, yearOf(today))}`;
  }
  const each = `${o.months} × ${formatPeso(r.monthlyCentavos ?? 0)}`;
  return r.addOnCentavos === 0 ? `0% · ${each}` : each;
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** How long the balance sits under the buffer (and under zero) with this option. */
export function belowLine(r: OptionResult, bufferCentavos: number): string {
  const buf = formatPeso(bufferCentavos);
  if (r.daysBelowBuffer === 0) return `Never below your ${buf} buffer`;
  const line = `${days(r.daysBelowBuffer)} below your ${buf} buffer`;
  return r.daysBelowZero === 0 ? line : `${line} · ${days(r.daysBelowZero)} below ₱0`;
}

/** The engine's "right after your Paluwagan", as a sentence; a fallback when it gives none. */
export function bestReason(reason: string | null, bufferCentavos: number): string {
  if (!reason) return `You stay above your ${formatPeso(bufferCentavos)} buffer from that day on`;
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

// ---------------------------------------------------------------- add to plan

/**
 * A saved installment has one amount, so `months` × the rounded monthly can
 * miss the engine's plan total (the price, for 0%) by a few centavos. Says so
 * ("6 × ₱4,831.67 = ₱28,990.02 (₱0.02 more than the price because of
 * rounding)"); null when it adds up exactly. Integer centavos only.
 */
export function planTotalNote(monthlyCentavos: number, months: number, totalPaidCentavos: number): string | null {
  const total = monthlyCentavos * months;
  const diff = total - totalPaidCentavos;
  if (diff === 0) return null;
  const how = diff > 0 ? 'more' : 'less';
  return `${months} × ${formatPeso(monthlyCentavos)} = ${formatPeso(total)} (${formatPeso(Math.abs(diff))} ${how} than the price because of rounding)`;
}

/**
 * The item draft for "Add to plan" (check it with `validateItem`):
 * - cash: a one-time outflow of the price on `date`;
 * - installment: `months` monthly payments of the engine's monthly amount,
 *   the first one month after `date`, then anchored on `date`'s day of the
 *   month (Jan 31 gives Feb 28, Mar 31, ...), the same rule the engine uses.
 */
export function planDraft(a: {
  name: string;
  price: string;
  date: string;
  option: PayOption;
  monthlyCentavos: number | null;
  included: boolean;
  existingIds: string[];
}): Partial<StoredItem> {
  const name = a.name.trim();
  const base = {
    id: newId(name, a.existingIds),
    name,
    currency: 'PHP',
    businessDay: 'none' as const,
    included: a.included,
    paidFrom: null,
  };
  if (a.option.type === 'cash') {
    return {
      ...base,
      kind: { type: 'oneOff', direction: 'out' },
      amount: a.price,
      schedule: { start: a.date, end: null, every: { type: 'once' } },
    };
  }
  return {
    ...base,
    kind: { type: 'installment', totalPayments: a.option.months, paidOverride: null },
    amount: centavosToDecimal(a.monthlyCentavos ?? 0),
    schedule: {
      start: shiftMonths(a.date, 1),
      end: null,
      every: { type: 'monthly', day: Number(a.date.slice(8, 10)) },
    },
  };
}
