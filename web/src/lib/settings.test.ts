import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type StoredItem } from './db';
import {
  ERASE_WORD,
  addCustomHoliday,
  checkAsOf,
  checkPassphrase,
  eraseConfirmed,
  formatRate,
  parseFeePct,
  rateCurrencies,
  removeCustomHoliday,
} from './settings';

describe('parseFeePct', () => {
  it('accepts 0 to 10, normalised like an amount', () => {
    expect(parseFeePct('0')).toEqual({ ok: true, value: '0.00' });
    expect(parseFeePct(' 2.5 ')).toEqual({ ok: true, value: '2.50' });
    expect(parseFeePct('10')).toEqual({ ok: true, value: '10.00' });
    expect(parseFeePct('3.5%')).toEqual({ ok: true, value: '3.50' });
  });
  it('rejects more than 10, negatives, junk and empty', () => {
    for (const s of ['10.01', '11', '-1', 'abc', '', '1.234']) expect(parseFeePct(s).ok).toBe(false);
  });
});

describe('custom holidays', () => {
  const s = { ...DEFAULT_SETTINGS('2026-11-13'), customHolidays: ['2026-12-08'], holidayNames: { '2026-12-08': 'Feast' } };

  it('adds a date (sorted, unique) with an optional trimmed name', () => {
    const a = addCustomHoliday(s, '2026-11-20', '  Shop anniversary ');
    expect(a).toEqual({
      ok: true,
      patch: { customHolidays: ['2026-11-20', '2026-12-08'], holidayNames: { '2026-12-08': 'Feast', '2026-11-20': 'Shop anniversary' } },
    });
    const b = addCustomHoliday(s, '2027-01-02', '');
    expect(b.ok && b.patch.holidayNames).toEqual({ '2026-12-08': 'Feast' });
  });

  it('rejects a bad or duplicate date', () => {
    expect(addCustomHoliday(s, '', 'x').ok).toBe(false);
    expect(addCustomHoliday(s, '2026-02-30', 'x').ok).toBe(false);
    expect(addCustomHoliday(s, '2026-12-08', 'x')).toEqual({ ok: false, error: 'That date is already on your list.' });
  });

  it('removes a date and its name', () => {
    expect(removeCustomHoliday(s, '2026-12-08')).toEqual({ customHolidays: [], holidayNames: {} });
  });
});

describe('checkAsOf', () => {
  it('needs a real date no later than today', () => {
    expect(checkAsOf('2026-11-13', '2026-11-13')).toBeNull();
    expect(checkAsOf('2026-10-01', '2026-11-13')).toBeNull();
    expect(checkAsOf('2026-11-14', '2026-11-13')).toMatch(/future/);
    expect(checkAsOf('', '2026-11-13')).toMatch(/date/);
  });
});

describe('checkPassphrase', () => {
  it('needs 8+ characters and a matching second entry', () => {
    expect(checkPassphrase('short', 'short')).toEqual({ first: 'Use at least 8 characters.', second: null });
    expect(checkPassphrase('long enough', 'long enougH')).toEqual({ first: null, second: 'The two passwords don’t match.' });
    expect(checkPassphrase('long enough', 'long enough')).toEqual({ first: null, second: null });
    expect(checkPassphrase('', '')).toEqual({ first: 'Enter a password.', second: null });
  });
  it('counts characters, not UTF-16 units', () => {
    expect(checkPassphrase('ñññññññ😀', 'ñññññññ😀').first).toBeNull();
    expect(checkPassphrase('😀😀😀😀', '😀😀😀😀').first).not.toBeNull();
  });
});

describe('eraseConfirmed', () => {
  it('needs BURAHON exactly (case-sensitive, surrounding spaces ignored)', () => {
    expect(ERASE_WORD).toBe('BURAHON');
    expect(eraseConfirmed('BURAHON')).toBe(true);
    expect(eraseConfirmed(' BURAHON ')).toBe(true);
    expect(eraseConfirmed('burahon')).toBe(false);
    expect(eraseConfirmed('Burahon')).toBe(false);
    expect(eraseConfirmed('')).toBe(false);
  });
});

describe('rateCurrencies', () => {
  it('always USD, plus any other foreign currency in the items', () => {
    const it = (currency: string) => ({ currency }) as StoredItem;
    expect(rateCurrencies([])).toEqual(['USD']);
    expect(rateCurrencies([it('PHP'), it('sgd'), it('EUR'), it('USD')])).toEqual(['USD', 'EUR', 'SGD']);
  });
});

describe('formatRate', () => {
  it('2 decimals (half up), 4 below 1, for display only', () => {
    expect(formatRate('63.727')).toBe('63.73');
    expect(formatRate('58.5')).toBe('58.50');
    expect(formatRate('64')).toBe('64.00');
    expect(formatRate('63.725')).toBe('63.73');
    expect(formatRate('0.38125')).toBe('0.3813');
    expect(formatRate('9.999')).toBe('10.00');
    expect(formatRate('junk')).toBe('junk');
  });
});
