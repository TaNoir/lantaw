// Settings screen helpers: validation and small pure updates. No state.

import type { AppSettings, StoredItem } from './db';
import { isIsoDate } from './items';
import { parseAmount, type ParseResult } from './money';

/** Typed to confirm "Erase everything". Case-sensitive. */
export const ERASE_WORD = 'BURAHON';

export const PASSPHRASE_MIN = 8;

/** Card foreign-transaction fee, 0–10 %, as a 2-dp decimal string. A trailing "%" is allowed. */
export function parseFeePct(raw: string): ParseResult {
  const r = parseAmount(raw.trim().replace(/%$/, ''));
  if (!r.ok) return r.error === 'Enter an amount.' ? { ok: false, error: 'Enter the fee, like 2.5.' } : r;
  const [whole, frac] = r.value.split('.');
  if (Number(whole) > 10 || (whole === '10' && frac !== '00')) return { ok: false, error: 'Use a fee from 0 to 10%.' };
  return r;
}

type HolidayPatch = Pick<AppSettings, 'customHolidays' | 'holidayNames'>;

/** Adds `date` (with an optional name) to the custom holidays, sorted and unique. */
export function addCustomHoliday(
  s: Pick<AppSettings, 'customHolidays' | 'holidayNames'>,
  date: string,
  name: string,
): { ok: true; patch: HolidayPatch } | { ok: false; error: string } {
  if (!isIsoDate(date)) return { ok: false, error: 'Pick a date.' };
  if (s.customHolidays.includes(date)) return { ok: false, error: 'That date is already on your list.' };
  const names = { ...(s.holidayNames ?? {}) };
  const nm = name.trim().slice(0, 40);
  if (nm) names[date] = nm;
  return { ok: true, patch: { customHolidays: [...s.customHolidays, date].sort(), holidayNames: names } };
}

export function removeCustomHoliday(
  s: Pick<AppSettings, 'customHolidays' | 'holidayNames'>,
  date: string,
): HolidayPatch {
  const names = { ...(s.holidayNames ?? {}) };
  delete names[date];
  return { customHolidays: s.customHolidays.filter((d) => d !== date), holidayNames: names };
}

/** The balance's as-of date: a real date, not after today. Null when fine. */
export function checkAsOf(asOf: string, today: string): string | null {
  if (!isIsoDate(asOf)) return 'Pick the date of this balance.';
  if (asOf > today) return 'The balance date can’t be in the future.';
  return null;
}

/** Export passphrase: at least 8 characters (code points), typed the same twice. */
export function checkPassphrase(first: string, second: string): { first: string | null; second: string | null } {
  if (first === '') return { first: 'Enter a password.', second: null };
  if ([...first].length < PASSPHRASE_MIN) return { first: `Use at least ${PASSPHRASE_MIN} characters.`, second: null };
  if (first !== second) return { first: null, second: 'The two passwords don’t match.' };
  return { first: null, second: null };
}

export function eraseConfirmed(typed: string): boolean {
  return typed.trim() === ERASE_WORD;
}

/** The rates Settings shows: USD always, then any other foreign currency the items use. */
export function rateCurrencies(items: Pick<StoredItem, 'currency'>[]): string[] {
  const others = [...new Set(items.map((i) => i.currency.toUpperCase()))]
    .filter((c) => c !== 'PHP' && c !== 'USD')
    .sort();
  return ['USD', ...others];
}

/**
 * A PHP-per-unit rate for display: 2 decimals, or 4 when under 1 (JPY),
 * rounded half up with integer math. Anything unparseable is shown as is.
 */
export function formatRate(rate: string): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(rate.trim());
  if (!m) return rate;
  const dp = m[1].replace(/^0+/, '') === '' ? 4 : 2;
  const frac = m[2] ?? '';
  // One extra digit, then round it away: 63.727 -> 63727 -> 6373.
  const scaled = BigInt(m[1] + frac.padEnd(dp + 1, '0').slice(0, dp + 1));
  const str = ((scaled + 5n) / 10n).toString().padStart(dp + 1, '0');
  return `${BigInt(str.slice(0, -dp)).toString()}.${str.slice(-dp)}`;
}
