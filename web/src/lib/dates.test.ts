import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, formatDate, formatDayRange, formatMonthTick, formatShort, weekday } from './dates';

describe('date string arithmetic (UTC-safe)', () => {
  it('counts whole days between ISO dates', () => {
    expect(daysBetween('2026-11-13', '2026-11-13')).toBe(0);
    expect(daysBetween('2026-11-13', '2026-11-27')).toBe(14);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2027-03-01', '2027-02-27')).toBe(-2);
    // Across a leap day.
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('adds days, crossing months and years', () => {
    expect(addDays('2026-11-13', 0)).toBe('2026-11-13');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-11-13', 365)).toBe('2027-11-13');
  });

  it('knows the weekday', () => {
    expect(weekday('2026-11-15')).toBe('Sun');
    expect(weekday('2026-11-13')).toBe('Fri');
  });
});

describe('labels', () => {
  it('formats a full date', () => {
    expect(formatDate('2027-03-15')).toBe('Mar 15, 2027');
    expect(formatDate('2026-11-01')).toBe('Nov 1, 2026');
  });

  it('formats a short date, adding the year only when it differs', () => {
    expect(formatShort('2027-02-28', 2027)).toBe('Feb 28');
    expect(formatShort('2027-02-28', 2026)).toBe('Feb 28, 2027');
    expect(formatShort('2027-02-28')).toBe('Feb 28');
  });

  it('formats a day range', () => {
    expect(formatDayRange('2027-03-15', '2027-03-29')).toBe('Mar 15–29');
    expect(formatDayRange('2026-11-27', '2026-12-14')).toBe('Nov 27 – Dec 14');
    expect(formatDayRange('2026-12-30', '2027-01-14')).toBe('Dec 30 – Jan 14');
    expect(formatDayRange('2027-03-15', '2027-03-15')).toBe('Mar 15');
  });

  it('formats month ticks', () => {
    expect(formatMonthTick('2027-01-01', true)).toBe('Jan ’27');
    expect(formatMonthTick('2027-04-01', false)).toBe('Apr');
  });
});
