// Items: validation, ids, quick-add presets, the sample rebase and the small
// helpers the Items screen and editor share. Pure functions, no state.

import { DEFAULT_SETTINGS, type AppSettings, type StoredItem } from './db';
import type {
  BusinessDayRule,
  Cadence,
  Direction,
  Input,
  ItemKind,
  KinsenasSecond,
  Projection,
  Schedule,
} from './engine-types';
import { parseAmount } from './money';
import { addDays, formatDate, weekday } from './dates';
import { ordinal } from './cutoff';

export type KindType = ItemKind['type'];
export type CadenceType = Cadence['type'];

export const NAME_MAX = 40;

/** Offered in the currency picker. Any other 3-letter code still works (e.g. from a backup). */
export const CURRENCIES = ['PHP', 'USD', 'EUR', 'SGD', 'JPY', 'GBP', 'AUD', 'CAD', 'HKD'] as const;

export const PAID_FROM = ['GCash', 'Maya', 'BPI', 'BDO', 'Cash'] as const;

const SYMBOL: Record<string, string> = {
  PHP: '₱',
  USD: '$',
  EUR: '€',
  SGD: 'S$',
  JPY: '¥',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$',
  HKD: 'HK$',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Days in a month; February counts 29 so a yearly Feb 29 is allowed (the engine clamps). */
function daysInMonth(month: number, year = 2000): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = [Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10))];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(m, y);
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const inRange = (n: unknown, lo: number, hi: number): n is number => isInt(n) && n >= lo && n <= hi;

/** income starts on the working day before; everything else lands on the date as written. */
export function defaultBusinessDay(kind: KindType): BusinessDayRule {
  return kind === 'income' ? 'previous' : 'none';
}

export const BUSINESS_DAY_LABELS: Record<BusinessDayRule, string> = {
  none: 'Pay on the date as written',
  previous: 'Move to the working day before',
  next: 'Move to the working day after',
};

// ---------------------------------------------------------------- validation

export type ItemErrors = Partial<Record<ItemField, string>>;
export type ItemField =
  | 'kind'
  | 'name'
  | 'amount'
  | 'currency'
  | 'totalPayments'
  | 'paidOverride'
  | 'members'
  | 'myTurn'
  | 'every'
  | 'month'
  | 'day'
  | 'start'
  | 'end';

/** Form order, so a failed save can focus the first field with a problem. */
export const FIELD_ORDER: ItemField[] = [
  'kind',
  'name',
  'amount',
  'currency',
  'totalPayments',
  'paidOverride',
  'members',
  'myTurn',
  'every',
  'month',
  'day',
  'start',
  'end',
];

/**
 * Checks a draft and returns a clean `StoredItem` (trimmed name, normalised
 * amount, end dropped for one-time items) or a message per field.
 */
export function validateItem(
  draft: Partial<StoredItem>,
): { ok: true; item: StoredItem } | { ok: false; errors: Record<string, string> } {
  const errors: ItemErrors = {};

  const name = (draft.name ?? '').trim();
  if (name === '') errors.name = 'Give it a name.';
  else if (name.length > NAME_MAX) errors.name = `Keep the name to ${NAME_MAX} characters or fewer.`;

  const amount = parseAmount(draft.amount ?? '');
  if (!amount.ok) errors.amount = amount.error;

  const currency = draft.currency ?? 'PHP';
  if (currency !== 'PHP' && !/^[A-Z]{3}$/.test(currency)) errors.currency = 'Use a 3-letter currency code, like USD.';

  let kind: ItemKind | null = null;
  const k = draft.kind;
  switch (k?.type) {
    case 'income':
      kind = { type: 'income', mainSweldo: k.mainSweldo === true };
      break;
    case 'bill':
      kind = { type: 'bill' };
      break;
    case 'installment': {
      const total = k.totalPayments;
      if (!inRange(total, 1, 120)) errors.totalPayments = 'Enter the number of payments, from 1 to 120.';
      const paid = k.paidOverride ?? null;
      if (paid !== null) {
        const hi = inRange(total, 1, 120) ? total : 120;
        if (!inRange(paid, 0, hi)) {
          errors.paidOverride = inRange(total, 1, 120)
            ? `Enter how many you’ve paid, from 0 to ${total}.`
            : 'Enter how many you’ve paid, 0 or more.';
        }
      }
      kind = { type: 'installment', totalPayments: total, paidOverride: paid };
      break;
    }
    case 'paluwagan': {
      const { members, myTurn } = k;
      if (!inRange(members, 2, 50)) errors.members = 'A paluwagan has 2 to 50 members.';
      const hi = inRange(members, 2, 50) ? members : 50;
      if (!inRange(myTurn, 1, hi)) {
        errors.myTurn = inRange(members, 2, 50) ? `Your turn is from 1 to ${members}.` : 'Enter your turn, 1 or more.';
      }
      kind = { type: 'paluwagan', members, myTurn };
      break;
    }
    case 'oneOff':
      kind = { type: 'oneOff', direction: k.direction === 'in' ? 'in' : 'out' };
      break;
    default:
      errors.kind = 'Pick what kind of item this is.';
  }

  const s = draft.schedule;
  const start = s?.start ?? '';
  if (!isIsoDate(start)) errors.start = 'Pick a start date.';

  let every: Cadence | null = null;
  const e = s?.every;
  switch (e?.type) {
    case 'once':
    case 'weekly':
    case 'everyTwoWeeks':
      every = { type: e.type };
      break;
    case 'kinsenas':
      every = { type: 'kinsenas', second: e.second === 'lastDay' ? 'lastDay' : 'thirtieth' };
      break;
    case 'monthly':
      if (!inRange(e.day, 1, 31)) errors.day = 'Pick a day from 1 to 31.';
      every = { type: 'monthly', day: e.day };
      break;
    case 'yearly':
      if (!inRange(e.month, 1, 12)) errors.month = 'Pick a month.';
      else if (!inRange(e.day, 1, daysInMonth(e.month))) {
        errors.day = `${MONTH_NAMES[e.month - 1]} has days 1 to ${daysInMonth(e.month)}.`;
      }
      every = { type: 'yearly', month: e.month, day: e.day };
      break;
    default:
      errors.every = 'Pick how often this happens.';
  }

  let end: string | null = s?.end ?? null;
  if (every?.type === 'once') end = null;
  if (end !== null) {
    if (!isIsoDate(end)) errors.end = 'Pick a real end date, or leave it empty.';
    else if (isIsoDate(start) && end < start) errors.end = 'The end date can’t be before the start date.';
  }

  if (Object.keys(errors).length > 0 || !kind || !every || !amount.ok) {
    return { ok: false, errors: errors as Record<string, string> };
  }

  const rule = draft.businessDay;
  const paidFrom = (draft.paidFrom ?? '').trim();
  return {
    ok: true,
    item: {
      id: draft.id && draft.id.trim() !== '' ? draft.id : newId(name, []),
      name,
      kind,
      amount: amount.value,
      currency,
      schedule: { start, end, every },
      businessDay: rule === 'none' || rule === 'previous' || rule === 'next' ? rule : defaultBusinessDay(kind.type),
      included: draft.included !== false,
      paidFrom: paidFrom === '' ? null : paidFrom,
      createdAt: draft.createdAt ?? 0,
      updatedAt: draft.updatedAt ?? 0,
    },
  };
}

// ---------------------------------------------------------------- main sweldo, ids, copies

const isMain = (i: StoredItem) => i.kind.type === 'income' && i.kind.mainSweldo;

/**
 * Makes `id` the one main sweldo. Incomes whose flag changes become new
 * objects; everything else keeps its identity. A non-income id is ignored.
 */
export function setMainSweldo(items: StoredItem[], id: string): StoredItem[] {
  const target = items.find((i) => i.id === id);
  if (!target || target.kind.type !== 'income') return items;
  return items.map((i) => {
    if (i.kind.type !== 'income') return i;
    const want = i.id === id;
    return i.kind.mainSweldo === want ? i : { ...i, kind: { type: 'income', mainSweldo: want } };
  });
}

/**
 * The incomes to rewrite so exactly one is the main sweldo: with none flagged,
 * the earliest income (by `createdAt`) is promoted; with several, all but the
 * earliest flagged one lose the flag. Empty when nothing needs to change or
 * there is no income at all. Used after a save and after a delete.
 */
export function ensureMainSweldo(items: StoredItem[]): StoredItem[] {
  const incomes = items
    .filter((i) => i.kind.type === 'income')
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  if (incomes.length === 0) return [];
  const keep = incomes.find(isMain) ?? incomes[0];
  const next = setMainSweldo(incomes, keep.id);
  return next.filter((i, n) => i !== incomes[n]);
}

/**
 * Everything to write when `saved` is saved: the item itself, plus any income
 * whose main-sweldo flag has to change. An income saved while no other income
 * is the main sweldo becomes it; if the main sweldo stops being an income,
 * the earliest remaining income takes over. So whenever incomes exist,
 * exactly one is the main sweldo.
 */
export function itemsToSave(items: StoredItem[], saved: StoredItem): StoredItem[] {
  let item = saved;
  const others = items.filter((i) => i.id !== saved.id);
  if (item.kind.type === 'income' && !item.kind.mainSweldo && !others.some(isMain)) {
    item = { ...item, kind: { type: 'income', mainSweldo: true } };
  }
  const list = [...others, item];
  const next = isMain(item) ? setMainSweldo(list, item.id) : list;
  const writes = next.filter((i, n) => i !== list[n] || i === item);
  // Repair whatever is still off (e.g. the main sweldo was changed into a bill).
  const fixes = new Map(ensureMainSweldo(next).map((i) => [i.id, i]));
  const merged = writes.map((i) => fixes.get(i.id) ?? i);
  for (const f of fixes.values()) if (!writes.some((w) => w.id === f.id)) merged.push(f);
  return merged;
}

/** "Davao Light" -> "davao-light"; "-2", "-3"... when taken. */
export function newId(name: string, existing: string[]): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item';
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** A copy named "<name> (copy)" with a new id. A copied income is never the main sweldo. */
export function duplicateItem(item: StoredItem, existingIds: string[]): StoredItem {
  const suffix = ' (copy)';
  const name = `${item.name.slice(0, NAME_MAX - suffix.length).trimEnd()}${suffix}`;
  const kind: ItemKind = item.kind.type === 'income' ? { type: 'income', mainSweldo: false } : item.kind;
  return { ...item, id: newId(name, existingIds), name, kind, createdAt: 0, updatedAt: 0 };
}

// ---------------------------------------------------------------- presets

const monthlyBill = (name: string, amount: string, day: number, currency = 'PHP'): Partial<StoredItem> => ({
  name,
  kind: { type: 'bill' },
  amount,
  currency,
  schedule: { start: '', end: null, every: { type: 'monthly', day } },
  businessDay: 'none',
});

const hulog = (name: string, totalPayments: number): Partial<StoredItem> => ({
  name,
  kind: { type: 'installment', totalPayments, paidOverride: null },
  amount: '',
  currency: 'PHP',
  businessDay: 'none',
});

/**
 * Quick-add chips, keyed by chip label. Amounts are typical figures the user
 * edits; installments and the paluwagan leave the amount empty so it has to be
 * typed. `presetItem` fills in the start date (and the day for hulog).
 */
export const PRESETS: Record<string, Partial<StoredItem>> = {
  'Davao Light': monthlyBill('Davao Light', '1850', 15),
  DCWD: monthlyBill('DCWD', '420', 20),
  Internet: monthlyBill('Internet', '1500', 5),
  Postpaid: monthlyBill('Postpaid', '999', 13),
  Netflix: monthlyBill('Netflix', '549', 8),
  Spotify: monthlyBill('Spotify', '194', 10),
  ChatGPT: monthlyBill('ChatGPT', '20', 22, 'USD'),
  YouTube: monthlyBill('YouTube Premium', '179', 12),
  'Home Credit': hulog('Home Credit', 12),
  SPayLater: hulog('SPayLater', 6),
  GGives: hulog('GGives', 6),
  'Card 0%': hulog('Credit card 0%', 12),
  Paluwagan: {
    name: 'Paluwagan',
    kind: { type: 'paluwagan', members: 10, myTurn: 1 },
    amount: '',
    currency: 'PHP',
    businessDay: 'none',
  },
};

/** A preset as a new-item draft starting `today` (hulog and paluwagan repeat on today's day of month). */
export function presetItem(key: string, today: string): Partial<StoredItem> {
  const p = PRESETS[key];
  const every: Cadence = p.schedule?.every ?? { type: 'monthly', day: Number(today.slice(8, 10)) };
  return {
    ...p,
    kind: p.kind ? { ...p.kind } : undefined,
    schedule: { start: today, end: null, every: { ...every } },
    included: true,
    paidFrom: null,
  };
}

// ---------------------------------------------------------------- sample

/** `iso` moved by `months` whole months, the day clamped to the month's end. */
export function shiftMonths(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, daysInMonth(nm, ny)))}`;
}

/**
 * The sample budget moved to `today`: every date shifts by the calendar months
 * between the fixture's `balanceAsOf` and `today` (day of month kept, clamped),
 * `balanceAsOf` becomes `today`, and the settings are marked as sample data.
 */
export function rebaseSample(sample: Input, today: string): { settings: AppSettings; items: StoredItem[] } {
  const from = sample.settings.balanceAsOf;
  const months =
    (Number(today.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(today.slice(5, 7)) - Number(from.slice(5, 7)));
  const shift = (iso: string) => shiftMonths(iso, months);

  const extra = sample.settings as Partial<AppSettings>;
  const settings: AppSettings = {
    ...DEFAULT_SETTINGS(today),
    ...sample.settings,
    paidOnAsOf: [...(sample.settings.paidOnAsOf ?? [])],
    customHolidays: (extra.customHolidays ?? []).map(shift),
    balanceAsOf: today,
    onboarded: true,
    isSample: true,
  };
  const items: StoredItem[] = sample.items.map((it, n) => ({
    ...it,
    kind: { ...it.kind },
    schedule: {
      start: shift(it.schedule.start),
      end: it.schedule.end === null ? null : shift(it.schedule.end),
      every: { ...it.schedule.every },
    },
    createdAt: n + 1,
    updatedAt: n + 1,
  }));
  return { settings, items };
}

// ---------------------------------------------------------------- editor form

/** What the editor binds to: text fields stay strings until `draftFromForm`. */
export interface ItemForm {
  id: string | null;
  name: string;
  amount: string;
  currency: string;
  kind: KindType;
  mainSweldo: boolean;
  totalPayments: string;
  paidOverride: string;
  members: string;
  myTurn: string;
  direction: Direction;
  cadence: CadenceType;
  second: KinsenasSecond;
  day: string;
  month: string;
  start: string;
  end: string;
  businessDay: BusinessDayRule;
  included: boolean;
  paidFrom: string;
  createdAt: number;
  updatedAt: number;
}

/** A form for `item` (a stored item, a preset or a blank), with defaults for anything missing. */
export function formFromItem(item: Partial<StoredItem>, today: string): ItemForm {
  const k = item.kind;
  const kind: KindType = k?.type ?? 'bill';
  const s = item.schedule;
  const start = s?.start || today;
  const e = s?.every;
  const day = Number(start.slice(8, 10));
  return {
    id: item.id ?? null,
    name: item.name ?? '',
    amount: item.amount ? plainAmount(item.amount) : '',
    currency: item.currency ?? 'PHP',
    kind,
    mainSweldo: k?.type === 'income' ? k.mainSweldo : false,
    totalPayments: k?.type === 'installment' ? String(k.totalPayments) : '12',
    paidOverride: k?.type === 'installment' && k.paidOverride !== null ? String(k.paidOverride) : '',
    members: k?.type === 'paluwagan' ? String(k.members) : '10',
    myTurn: k?.type === 'paluwagan' ? String(k.myTurn) : '1',
    direction: k?.type === 'oneOff' ? k.direction : 'out',
    cadence: e?.type ?? defaultCadence(kind),
    second: e?.type === 'kinsenas' ? e.second : 'thirtieth',
    day: e?.type === 'monthly' || e?.type === 'yearly' ? String(e.day) : String(day),
    month: e?.type === 'yearly' ? String(e.month) : start.slice(5, 7).replace(/^0/, ''),
    start,
    end: s?.end ?? '',
    businessDay: item.businessDay ?? defaultBusinessDay(kind),
    included: item.included !== false,
    paidFrom: item.paidFrom ?? '',
    createdAt: item.createdAt ?? 0,
    updatedAt: item.updatedAt ?? 0,
  };
}

/** The usual schedule for a new item of this kind. */
export function defaultCadence(kind: KindType): CadenceType {
  if (kind === 'income') return 'kinsenas';
  if (kind === 'oneOff') return 'once';
  return 'monthly';
}

/** "2083.00" -> "2083", "1250.50" -> "1250.50": the stored amount as a person would type it. */
function plainAmount(a: string): string {
  return a.replace(/\.00$/, '');
}

/** A whole number from a text field; blank or anything else is NaN (never 0). */
function int(s: string): number {
  const t = s.trim();
  return /^-?\d+$/.test(t) ? Number(t) : Number.NaN;
}

export function draftFromForm(f: ItemForm): Partial<StoredItem> {
  let kind: ItemKind;
  switch (f.kind) {
    case 'income':
      kind = { type: 'income', mainSweldo: f.mainSweldo };
      break;
    case 'installment':
      kind = {
        type: 'installment',
        totalPayments: int(f.totalPayments),
        paidOverride: f.paidOverride.trim() === '' ? null : int(f.paidOverride),
      };
      break;
    case 'paluwagan':
      kind = { type: 'paluwagan', members: int(f.members), myTurn: int(f.myTurn) };
      break;
    case 'oneOff':
      kind = { type: 'oneOff', direction: f.direction };
      break;
    default:
      kind = { type: 'bill' };
  }

  let every: Cadence;
  switch (f.cadence) {
    case 'kinsenas':
      every = { type: 'kinsenas', second: f.second };
      break;
    case 'monthly':
      every = { type: 'monthly', day: int(f.day) };
      break;
    case 'yearly':
      every = { type: 'yearly', month: int(f.month), day: int(f.day) };
      break;
    default:
      every = { type: f.cadence };
  }

  const draft: Partial<StoredItem> = {
    name: f.name,
    kind,
    amount: f.amount,
    currency: f.currency,
    schedule: { start: f.start, end: f.end.trim() === '' ? null : f.end, every },
    businessDay: f.businessDay,
    included: f.included,
    paidFrom: f.paidFrom,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
  if (f.id) draft.id = f.id;
  return draft;
}

// ---------------------------------------------------------------- list helpers

export const GROUPS: { kind: KindType; title: string }[] = [
  { kind: 'income', title: 'Sweldo & income' },
  { kind: 'installment', title: 'Hulog' },
  { kind: 'paluwagan', title: 'Paluwagan' },
  { kind: 'bill', title: 'Bills & subscriptions' },
  { kind: 'oneOff', title: 'One-off' },
];

/** Items in the screen's groups (empty groups left out), keeping the given order inside each. */
export function groupItems(items: StoredItem[]): { kind: KindType; title: string; items: StoredItem[] }[] {
  return GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.kind.type === g.kind) })).filter(
    (g) => g.items.length > 0,
  );
}

/** Case- and accent-insensitive name match. */
export function matchesSearch(name: string, query: string): boolean {
  const fold = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  return fold(name).includes(fold(query.trim()));
}

/** "Aug 2027" */
export function formatMonthLong(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/** Plain-words schedule: "monthly 22nd", "kinsenas 15 & 30", "every Dec 15", "Dec 20, 2026". */
export function scheduleLabel(s: Schedule): string {
  const e = s.every;
  switch (e.type) {
    case 'once':
      return formatDate(s.start);
    case 'weekly':
      return `weekly on ${weekday(s.start)}`;
    case 'everyTwoWeeks':
      return `every 2 weeks on ${weekday(s.start)}`;
    case 'kinsenas':
      return e.second === 'thirtieth' ? 'kinsenas 15 & 30' : 'kinsenas 15 & last day';
    case 'monthly':
      return `monthly ${ordinal(e.day)}`;
    case 'yearly':
      return `every ${MONTHS[e.month - 1]} ${e.day}`;
  }
}

/**
 * Progress for hulog ("3 of 12 · ends Aug 2027") and paluwagan
 * ("turn 4 of 10 · payout May 2027"), read from the item's events in the
 * forecast. Null for other kinds.
 */
export function itemProgress(p: Projection | null, item: StoredItem): string | null {
  const k = item.kind;
  if (k.type !== 'installment' && k.type !== 'paluwagan') return null;
  const evs = p ? p.events.filter((e) => e.itemId === item.id) : [];

  if (k.type === 'installment') {
    if (evs.length === 0) {
      const neutral = `${k.totalPayments} payments`;
      // Without a forecast, or for a what-if, there is nothing to judge by.
      if (!p || !item.included) return neutral;
      const windowEnd = addDays(p.start, Math.max(0, p.days.length - 1));
      const firstDue = firstDate(item.schedule);
      if (firstDue && firstDue > windowEnd) return `${neutral} · starts ${formatMonthLong(firstDue)}`;
      if (k.paidOverride !== null && k.paidOverride >= k.totalPayments) {
        return `${k.totalPayments} of ${k.totalPayments} · paid off`;
      }
      const last = k.paidOverride === null ? lastPaymentDate(item.schedule, k.totalPayments) : null;
      if (last && last < p.start) return `${k.totalPayments} of ${k.totalPayments} · paid off`;
      return neutral;
    }
    const num = (note: string | null) => Number(/(\d+) of \d+/.exec(note ?? '')?.[1] ?? NaN);
    const first = evs[0];
    const last = evs[evs.length - 1];
    const lastK = num(last.note);
    // Past the window, a monthly hulog's last month is still known: one month per payment left.
    const tail =
      lastK === k.totalPayments
        ? `ends ${formatMonthLong(last.date)}`
        : item.schedule.every.type === 'monthly' && Number.isFinite(lastK)
          ? `ends ${formatMonthLong(shiftMonths(last.nominalDate, k.totalPayments - lastK))}`
          : `continues past ${formatMonthLong(last.date)}`;
    return `${num(first.note)} of ${k.totalPayments} · ${tail}`;
  }

  if (evs.length === 0) return `${k.members} members · turn ${k.myTurn}`;
  const payout = evs.find((e) => e.centavos > 0);
  const firstTurn = /turn (\d+) of/.exec(evs[0].note ?? '')?.[1] ?? (payout === evs[0] ? String(k.myTurn) : '?');
  const tail = payout ? `payout ${formatMonthLong(payout.date)}` : k.myTurn < Number(firstTurn) ? 'payout received' : '';
  return [`turn ${firstTurn} of ${k.members}`, tail].filter(Boolean).join(' · ');
}

/** Amount in its own currency: "₱1,850", "$20", "¥1,500", "20.50 XYZ". */
export function formatMoney(amount: string, currency: string): string {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) return amount;
  const whole = m[1].replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = (m[2] ?? '').padEnd(2, '0');
  const num = cents === '00' ? whole : `${whole}.${cents}`;
  const sym = SYMBOL[currency];
  return sym ? `${sym}${num}` : `${num} ${currency}`;
}

/** "$" for USD, "S$" for SGD, or the code itself. */
export function currencySymbol(currency: string): string {
  return SYMBOL[currency] ?? currency;
}

/** A plain decimal string as a big integer and its number of decimal places. */
function decimal(s: string): { n: bigint; scale: number } | null {
  const m = /^\s*(\d+)(?:\.(\d+))?\s*$/.exec(s.replace(/,/g, ''));
  if (!m) return null;
  const frac = m[2] ?? '';
  return { n: BigInt(m[1] + frac), scale: frac.length };
}

/**
 * Foreign amount to peso centavos the way the engine does it:
 * amount × rate × (1 + fee/100), rounded half away from zero. Integer math.
 */
export function convertToPhp(amount: string, phpPerUnit: string, feePct: string): number | null {
  const a = decimal(amount);
  const r = decimal(phpPerUnit);
  const f = decimal(feePct || '0');
  if (!a || !r || !f) return null;
  const fScale = 10n ** BigInt(f.scale);
  // centavos = A·R·(100·10^sf + F) / 10^(sa + sr + sf)
  const num = a.n * r.n * (100n * fScale + f.n);
  const den = 10n ** BigInt(a.scale + r.scale + f.scale);
  return Number((num * 2n + den) / (2n * den));
}

/** The first nominal date of a schedule (before any business-day shift), for the editor's hint. */
export function firstDate(s: Schedule): string | null {
  if (!isIsoDate(s.start)) return null;
  const e = s.every;
  const y = Number(s.start.slice(0, 4));
  const m = Number(s.start.slice(5, 7));
  const at = (yy: number, mm: number, dd: number) => {
    const total = yy * 12 + (mm - 1);
    const ny = Math.floor(total / 12);
    const nm = total - ny * 12 + 1;
    return `${ny}-${pad(nm)}-${pad(Math.min(dd, daysInMonth(nm, ny)))}`;
  };
  switch (e.type) {
    case 'once':
    case 'weekly':
    case 'everyTwoWeeks':
      return s.start;
    case 'monthly': {
      if (!inRange(e.day, 1, 31)) return null;
      const d = at(y, m, e.day);
      return d >= s.start ? d : at(y, m + 1, e.day);
    }
    case 'kinsenas': {
      const second = e.second === 'thirtieth' ? 30 : 31;
      for (const c of [at(y, m, 15), at(y, m, second), at(y, m + 1, 15)]) if (c >= s.start) return c;
      return null;
    }
    case 'yearly': {
      if (!inRange(e.month, 1, 12) || !inRange(e.day, 1, 31)) return null;
      const d = at(y, e.month, e.day);
      return d >= s.start ? d : at(y + 1, e.month, e.day);
    }
  }
}

/**
 * Nominal date of payment `n` (1-based) of a schedule, capped by its end date;
 * null when the schedule has fewer than `n` dates. Mirrors the engine's
 * anchored rules (monthly from the anchor, kinsenas twice a month, ...).
 */
export function lastPaymentDate(s: Schedule, n: number): string | null {
  const first = firstDate(s);
  if (!first || !isInt(n) || n < 1) return null;
  const e = s.every;
  let d: string | null;
  switch (e.type) {
    case 'once':
      d = n === 1 ? first : null;
      break;
    case 'weekly':
      d = addDays(first, 7 * (n - 1));
      break;
    case 'everyTwoWeeks':
      d = addDays(first, 14 * (n - 1));
      break;
    case 'monthly':
      d = withDay(shiftMonths(first, n - 1), e.day);
      break;
    case 'yearly':
      d = withDay(shiftMonths(first, 12 * (n - 1)), e.day);
      break;
    case 'kinsenas': {
      // Dates go 15th, second, 15th, second... starting from whichever comes first.
      const startsMid = Number(first.slice(8, 10)) === 15;
      const steps = n - 1 + (startsMid ? 0 : 1); // count from the 15th of first's month
      const month = shiftMonths(`${first.slice(0, 8)}01`, Math.floor(steps / 2));
      d = steps % 2 === 0 ? withDay(month, 15) : withDay(month, e.second === 'thirtieth' ? 30 : 31);
      break;
    }
  }
  if (d && s.end && d > s.end) return null;
  return d;
}

/** `iso`'s month with `day` clamped to its end. */
function withDay(iso: string, day: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return `${iso.slice(0, 8)}${pad(Math.min(day, daysInMonth(m, y)))}`;
}
