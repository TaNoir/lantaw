import { describe, expect, it } from 'vitest';
import type { Cutoff } from './engine-types';
import { movedReason, ordinal } from './cutoff';

const c = (nominal: string, payday: string): Cutoff => ({
  payday, nominal, end: payday, incomeCentavos: 0, outflowCentavos: 0, leftCentavos: 0, eventIndices: [],
});

describe('ordinal', () => {
  it('handles teens and suffixes', () => {
    expect([11, 12, 13].map(ordinal)).toEqual(['11th', '12th', '13th']);
    expect([1, 2, 3, 21, 22, 30].map(ordinal)).toEqual(['1st', '2nd', '3rd', '21st', '22nd', '30th']);
  });
});

describe('movedReason', () => {
  it('is empty when the payday did not move', () => {
    expect(movedReason(c('2026-11-13', '2026-11-13'))).toBe('');
  });
  it('explains a weekend', () => {
    expect(movedReason(c('2026-11-15', '2026-11-13'))).toBe('Sweldo comes Fri Nov 13 because the 15th is a Sunday.');
    expect(movedReason(c('2027-05-15', '2027-05-14'))).toContain('is a Saturday');
  });
  it('explains a holiday', () => {
    expect(movedReason(c('2026-12-30', '2026-12-29'))).toBe('Sweldo comes Tue Dec 29 because Dec 30 is a holiday.');
  });
});
