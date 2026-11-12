import { describe, expect, it } from 'vitest';
import { formatPeso, parseAmount } from './money';

describe('formatPeso', () => {
  it('formats whole and fractional pesos', () => {
    expect(formatPeso(1248000)).toBe('₱12,480');
    expect(formatPeso(1248050)).toBe('₱12,480.50');
    expect(formatPeso(0)).toBe('₱0');
  });
  it('uses U+2212 for negatives', () => {
    expect(formatPeso(-124000)).toBe('−₱1,240');
    expect(formatPeso(-5)).toBe('−₱0.05');
  });
  it('groups large amounts', () => {
    expect(formatPeso(123456700)).toBe('₱1,234,567');
  });
});

describe('parseAmount', () => {
  it('normalizes valid input', () => {
    expect(parseAmount('1,234.5')).toEqual({ ok: true, value: '1234.50' });
    expect(parseAmount(' 1000 ')).toEqual({ ok: true, value: '1000.00' });
    expect(parseAmount('0.5')).toEqual({ ok: true, value: '0.50' });
    expect(parseAmount('999999999999.99')).toEqual({ ok: true, value: '999999999999.99' });
  });
  it('rejects bad input', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1000000000000', '  ', '1e5', '.']) {
      expect(parseAmount(bad).ok, bad).toBe(false);
    }
  });
});
