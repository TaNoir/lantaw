// First run: the sweldo form, the quick-add groups and the "Already in your
// balance?" checklist. Pure functions, no state; FirstRun.svelte and the
// AlreadyInBalance component use them.

import type { StoredItem } from './db';
import type { Cadence, EngineEvent } from './engine-types';
import { isIsoDate, newId, setMainSweldo } from './items';
import { parseAmount, toCentavos } from './money';

// ---------------------------------------------------------------- sweldo

export type SweldoSchedule = 'kinsenas30' | 'kinsenasLast' | 'monthly' | 'weekly' | 'everyTwoWeeks';

export const SWELDO_SCHEDULES: { id: SweldoSchedule; label: string }[] = [
  { id: 'kinsenas30', label: 'Kinsenas, 15 & 30' },
  { id: 'kinsenasLast', label: 'Kinsenas, 15 & last day' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'everyTwoWeeks', label: 'Every 2 weeks' },
];

/** What the sweldo step binds to. Amounts stay as typed until `buildSweldoItems`. */
export interface SweldoForm {
  /** Amount per payday. */
  amount: string;
  schedule: SweldoSchedule;
  /** Monthly only: day of the month, 1–31 (31 means the last day). */
  payDay: number;
  /** Weekly and every 2 weeks only: the next payday, YYYY-MM-DD. */
  nextPayday: string;
  thirteenth: boolean;
  thirteenthAmount: string;
}

export function blankSweldo(asOf: string): SweldoForm {
  return {
    amount: '',
    schedule: 'kinsenas30',
    payDay: 30,
    nextPayday: asOf,
    thirteenth: true,
    thirteenthAmount: '',
  };
}

/** Paydays in an average month: 2 for kinsenas, 52/12 weekly, 26/12 every 2 weeks. */
const PER_MONTH: Record<SweldoSchedule, [bigint, bigint]> = {
  kinsenas30: [2n, 1n],
  kinsenasLast: [2n, 1n],
  monthly: [1n, 1n],
  weekly: [52n, 12n],
  everyTwoWeeks: [26n, 12n],
};

/**
 * One month's pay in centavos for `perPayday` centavos on `schedule`. Weekly
 * and every-2-weeks pay is averaged over the year and rounded to the whole
 * peso (it's a suggested 13th month, not an exact figure). Integer math.
 */
export function monthlyPayCentavos(perPayday: number, schedule: SweldoSchedule): number {
  const [num, den] = PER_MONTH[schedule];
  const c = BigInt(Math.trunc(perPayday)) * num;
  if (den === 1n) return Number(c);
  const d = den * 100n; // to whole pesos, half away from zero
  return Number(((c * 2n + d) / (2n * d)) * 100n);
}

/** Integer centavos as a plain amount a person would type: 3600000 -> "36000", 12050 -> "120.50". */
export function plainFromCentavos(c: number): string {
  const abs = Math.abs(Math.trunc(c));
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${c < 0 ? '-' : ''}${whole}${cents === 0 ? '' : `.${String(cents).padStart(2, '0')}`}`;
}

/** The suggested 13th month (one month's pay) as a plain amount, or '' while the sweldo amount isn't valid. */
export function defaultThirteenth(amount: string, schedule: SweldoSchedule): string {
  const a = parseAmount(amount);
  if (!a.ok) return '';
  return plainFromCentavos(monthlyPayCentavos(toCentavos(a.value), schedule));
}

export type SweldoField = 'amount' | 'payDay' | 'nextPayday' | 'thirteenthAmount';
export type SweldoErrors = Partial<Record<SweldoField, string>>;

/** The first day of `iso`'s month. */
const monthStart = (iso: string) => `${iso.slice(0, 8)}01`;

function cadenceOf(f: SweldoForm): Cadence {
  switch (f.schedule) {
    case 'kinsenas30':
      return { type: 'kinsenas', second: 'thirtieth' };
    case 'kinsenasLast':
      return { type: 'kinsenas', second: 'lastDay' };
    case 'monthly':
      return { type: 'monthly', day: f.payDay };
    case 'weekly':
      return { type: 'weekly' };
    case 'everyTwoWeeks':
      return { type: 'everyTwoWeeks' };
  }
}

/**
 * The main sweldo (and the 13th month when switched on) from the form. Both
 * use the "working day before" rule. Kinsenas and monthly pay start from the
 * first of the balance's month, so a payday that moves onto the as-of date
 * (the 15th on a Sunday paid on Friday the 13th) still shows up on the
 * "Already in your balance?" checklist. Weekly pay starts on the next payday.
 * Ids are made unique against `existingIds`.
 */
export function buildSweldoItems(
  f: SweldoForm,
  asOf: string,
  existingIds: string[],
): { ok: true; items: StoredItem[] } | { ok: false; errors: SweldoErrors } {
  const errors: SweldoErrors = {};

  const amount = parseAmount(f.amount);
  if (!amount.ok) errors.amount = f.amount.trim() === '' ? 'Enter how much you get each payday.' : amount.error;
  else if (toCentavos(amount.value) === 0) errors.amount = 'Your sweldo has to be more than ₱0.';

  const weekly = f.schedule === 'weekly' || f.schedule === 'everyTwoWeeks';
  if (f.schedule === 'monthly' && !(Number.isInteger(f.payDay) && f.payDay >= 1 && f.payDay <= 31)) {
    errors.payDay = 'Pick a payday from the 1st to the 31st.';
  }
  if (weekly && !isIsoDate(f.nextPayday)) errors.nextPayday = 'Pick the date of your next payday.';

  let thirteenth: string | null = null;
  if (f.thirteenth) {
    const t = parseAmount(f.thirteenthAmount);
    if (!t.ok) {
      errors.thirteenthAmount = f.thirteenthAmount.trim() === '' ? 'Enter your 13th month amount, or switch it off.' : t.error;
    } else if (toCentavos(t.value) === 0) {
      errors.thirteenthAmount = 'Enter more than ₱0, or switch the 13th month off.';
    } else thirteenth = t.value;
  }

  if (Object.keys(errors).length > 0 || !amount.ok) return { ok: false, errors };

  const ids = [...existingIds];
  const base = {
    currency: 'PHP',
    businessDay: 'previous' as const,
    included: true,
    paidFrom: null,
    createdAt: 0,
    updatedAt: 0,
  };
  const sweldoId = newId('Sweldo', ids);
  ids.push(sweldoId);
  const items: StoredItem[] = [
    {
      ...base,
      id: sweldoId,
      name: 'Sweldo',
      kind: { type: 'income', mainSweldo: true },
      amount: amount.value,
      schedule: { start: weekly ? f.nextPayday : monthStart(asOf), end: null, every: cadenceOf(f) },
    },
  ];
  if (thirteenth !== null) {
    items.push({
      ...base,
      id: newId('13th month', ids),
      name: '13th month',
      kind: { type: 'income', mainSweldo: false },
      amount: thirteenth,
      schedule: { start: monthStart(asOf), end: null, every: { type: 'yearly', month: 12, day: 15 } },
    });
  }
  return { ok: true, items };
}

/**
 * Everything to write at the end of first run: the new sweldo items, plus any
 * income added during quick add that has to give up the main-sweldo flag, so
 * the sweldo from the form is the one main sweldo.
 */
export function firstRunWrites(existing: StoredItem[], sweldoItems: StoredItem[]): StoredItem[] {
  const main = sweldoItems.find((i) => i.kind.type === 'income' && i.kind.mainSweldo);
  if (!main) return sweldoItems;
  const all = [...existing, ...sweldoItems];
  const next = setMainSweldo(all, main.id);
  const demoted = next.filter((i, n) => n < existing.length && i !== existing[n]);
  return [...next.slice(existing.length), ...demoted];
}

// ---------------------------------------------------------------- quick add

/** Quick-add chips on first run, by group. Every key is a `PRESETS` key. */
export const QUICK_GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Bills', keys: ['Davao Light', 'DCWD', 'Internet', 'Postpaid'] },
  { title: 'Subscriptions', keys: ['Netflix', 'Spotify', 'ChatGPT', 'YouTube'] },
  { title: 'Hulog & groups', keys: ['Home Credit', 'SPayLater', 'GGives', 'Card 0%', 'Paluwagan'] },
];

// ---------------------------------------------------------------- "Already in your balance?"

export interface ChecklistRow {
  itemId: string;
  name: string;
  /** Signed: income positive, outflows negative. */
  centavos: number;
  /** The engine's notes ("2 of 6", "moved from Sun Nov 15"), joined. */
  note: string | null;
}

/**
 * One row per item for the events dated on the as-of date (`paidOnAsOf` works
 * per item, so an item's events that day are summed). What-if items are left
 * out because they aren't counted anyway.
 */
export function checklistRows(events: EngineEvent[]): ChecklistRow[] {
  const rows = new Map<string, ChecklistRow>();
  for (const e of events) {
    if (!e.included) continue;
    const row = rows.get(e.itemId);
    if (!row) {
      rows.set(e.itemId, { itemId: e.itemId, name: e.name, centavos: e.centavos, note: e.note });
      continue;
    }
    row.centavos += e.centavos;
    if (e.note) row.note = row.note ? `${row.note}, ${e.note}` : e.note;
  }
  return [...rows.values()];
}

/** `paid` with `id` ticked or unticked, keeping the order and never duplicating. */
export function togglePaid(paid: string[], id: string, on: boolean): string[] {
  const rest = paid.filter((p) => p !== id);
  return on ? [...rest, id] : rest;
}
