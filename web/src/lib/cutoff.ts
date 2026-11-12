import type { Cutoff } from './engine-types';
import { formatShort, weekday } from './dates';

const LONG_DAY: Record<string, string> = { Sat: 'Saturday', Sun: 'Sunday' };

export function ordinal(d: number): string {
  const t = d % 100;
  if (t >= 11 && t <= 13) return `${d}th`;
  return `${d}${['th', 'st', 'nd', 'rd'][d % 10] ?? 'th'}`;
}

/**
 * Why a payday moved off its nominal date, as human copy
 * ("Sweldo comes Fri Nov 13 because the 15th is a Sunday."). Empty when it did not move.
 */
export function movedReason(c: Cutoff): string {
  if (c.nominal === c.payday) return '';
  const wd = weekday(c.nominal);
  const why = LONG_DAY[wd]
    ? `the ${ordinal(Number(c.nominal.slice(8)))} is a ${LONG_DAY[wd]}`
    : `${formatShort(c.nominal)} is a holiday`;
  return `Sweldo comes ${weekday(c.payday)} ${formatShort(c.payday)} because ${why}.`;
}
