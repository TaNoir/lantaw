// Date helpers on "YYYY-MM-DD" strings. All arithmetic goes through Date.UTC,
// so no label ever shifts by a day because of the device's time zone.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 86_400_000;

function parts(iso: string): [number, number, number] {
  return [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))];
}

function utc(iso: string): number {
  const [y, m, d] = parts(iso);
  return Date.UTC(y, m - 1, d);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Device-local calendar date as YYYY-MM-DD. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(utc(iso) + n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function weekday(iso: string): string {
  return WEEKDAYS[new Date(utc(iso)).getUTCDay()];
}

export function yearOf(iso: string): number {
  return parts(iso)[0];
}

/** "Mar 15, 2027" */
export function formatDate(iso: string): string {
  const [y, m, d] = parts(iso);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "Feb 28", or "Feb 28, 2027" when the year differs from `refYear`. */
export function formatShort(iso: string, refYear?: number): string {
  const [y, m, d] = parts(iso);
  const base = `${MONTHS[m - 1]} ${d}`;
  return refYear !== undefined && refYear !== y ? `${base}, ${y}` : base;
}

/** "Mar 15–29", "Nov 27 – Dec 14", or "Mar 15" for a single day. */
export function formatDayRange(from: string, to: string): string {
  if (from === to) return formatShort(from);
  const [, m1] = parts(from);
  const [, m2, d2] = parts(to);
  if (m1 === m2 && yearOf(from) === yearOf(to)) return `${formatShort(from)}–${d2}`;
  return `${formatShort(from)} – ${formatShort(to)}`;
}

/** "Apr", or "Jan ’27" when `withYear`. */
export function formatMonthTick(iso: string, withYear: boolean): string {
  const [y, m] = parts(iso);
  return withYear ? `${MONTHS[m - 1]} ’${String(y).slice(2)}` : MONTHS[m - 1];
}

/** "Aug ’27" — month and short year. */
export function formatMonthYear(iso: string): string {
  return formatMonthTick(iso, true);
}

/** The first day of the month after `iso`'s month. */
export function nextMonthStart(iso: string): string {
  const [y, m] = parts(iso);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
}
