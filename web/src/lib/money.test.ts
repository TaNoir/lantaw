import { describe, expect, it } from 'vitest';
import { formatPeso, parseAmount, parseRate, toCentavos } from './money';

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

describe('toCentavos', () => {
  it('converts stored decimal strings to integer centavos without floats', () => {
    expect(toCentavos('3000')).toBe(300000);
    expect(toCentavos('3000.5')).toBe(300050);
    expect(toCentavos('12480.05')).toBe(1248005);
    expect(toCentavos('0')).toBe(0);
    expect(toCentavos('0.10')).toBe(10);
  });
  it('handles a leading minus and treats junk as zero', () => {
    expect(toCentavos('-1240')).toBe(-124000);
    expect(toCentavos('')).toBe(0);
    expect(toCentavos('abc')).toBe(0);
  });
});

describe('parseRate', () => {
  it('accepts exchange rates with up to 6 decimals', () => {
    expect(parseRate(' 63.727 ')).toEqual({ ok: true, value: '63.727' });
    expect(parseRate('0.3815')).toEqual({ ok: true, value: '0.3815' });
    expect(parseRate('1,234.5')).toEqual({ ok: true, value: '1234.5' });
    expect(parseRate('58')).toEqual({ ok: true, value: '58' });
  });
  it('rejects empty, zero, negative, junk and over-precise input', () => {
    for (const bad of ['', '0', '0.000', '-5', 'abc', '1.2345678', '.']) {
      expect(parseRate(bad).ok).toBe(false);
    }
  });
});
