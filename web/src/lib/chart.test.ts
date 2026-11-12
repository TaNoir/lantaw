import { describe, expect, it } from 'vitest';
import type { Cutoff } from './engine-types';
import { areaPath, downsample, nextCutoffIndex } from './chart';

function series(n: number): number[] {
  // A wavy balance with one unique deep low point and one unique high point.
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.round(500_000 + 300_000 * Math.sin(i / 9) + 1_000 * (i % 7)));
  out[437] = -1_240_00;
  out[101] = 9_999_999;
  return out;
}

describe('downsample', () => {
  it('keeps the global minimum (the gipit point) and its index', () => {
    const pts = downsample(series(730), 120);
    expect(pts).toContainEqual({ i: 437, v: -1_240_00 });
  });

  it('keeps the global maximum too', () => {
    expect(downsample(series(730), 120)).toContainEqual({ i: 101, v: 9_999_999 });
  });

  it('never returns more than maxPoints (2 per bucket)', () => {
    for (const max of [120, 61, 10, 4]) {
      expect(downsample(series(730), max).length).toBeLessThanOrEqual(max);
    }
  });

  it('keeps the first and last day so the line spans the full width', () => {
    const pts = downsample(series(730), 120);
    expect(pts[0]).toEqual({ i: 0, v: series(730)[0] });
    expect(pts[pts.length - 1]).toEqual({ i: 729, v: series(730)[729] });
  });

  it('returns points in strictly increasing index order', () => {
    const pts = downsample(series(730), 120);
    for (let k = 1; k < pts.length; k++) expect(pts[k].i).toBeGreaterThan(pts[k - 1].i);
  });

  it('returns every point when the series is already small enough', () => {
    expect(downsample([5, 3, 9], 120)).toEqual([
      { i: 0, v: 5 },
      { i: 1, v: 3 },
      { i: 2, v: 9 },
    ]);
    expect(downsample([], 120)).toEqual([]);
  });
});

describe('areaPath', () => {
  it('maps index to x across the width and value to y (max at the top)', () => {
    const p = areaPath(
      [
        { i: 0, v: 0 },
        { i: 1, v: 10 },
      ],
      100,
      50,
      0,
      10,
    );
    expect(p.line).toBe('M0,50L100,0');
    expect(p.area).toBe('M0,50L100,0L100,50L0,50Z');
  });

  it('uses the last point index as the right edge', () => {
    const p = areaPath(
      [
        { i: 0, v: 5 },
        { i: 2, v: 5 },
        { i: 4, v: 0 },
      ],
      200,
      100,
      0,
      10,
    );
    expect(p.line).toBe('M0,50L100,50L200,100');
  });

  it('rounds coordinates to 2 decimals', () => {
    const p = areaPath(
      [
        { i: 0, v: 1 },
        { i: 3, v: 2 },
      ],
      100,
      10,
      0,
      3,
    );
    expect(p.line).toBe('M0,6.67L100,3.33');
  });

  it('draws a flat series through the middle instead of dividing by zero', () => {
    const p = areaPath(
      [
        { i: 0, v: 7 },
        { i: 1, v: 7 },
      ],
      100,
      40,
      7,
      7,
    );
    expect(p.line).toBe('M0,20L100,20');
  });

  it('returns empty paths for no points', () => {
    expect(areaPath([], 100, 40, 0, 1)).toEqual({ line: '', area: '' });
  });
});

describe('nextCutoffIndex', () => {
  const cut = (payday: string): Cutoff => ({
    payday,
    nominal: payday,
    end: payday,
    incomeCentavos: 0,
    outflowCentavos: 0,
    leftCentavos: 0,
    eventIndices: [],
  });
  // Day indices from 2026-11-13: 0, 14, 32 (Dec 15), 49 (Jan 1 2027).
  const cutoffs = [cut('2026-11-13'), cut('2026-11-27'), cut('2026-12-15'), cut('2027-01-01')];
  const start = '2026-11-13';

  it('moves forward from mid-cutoff to the next payday', () => {
    expect(nextCutoffIndex(5, cutoffs, start, 1)).toBe(14);
    expect(nextCutoffIndex(20, cutoffs, start, 1)).toBe(32);
  });

  it('moves from a payday to the following payday', () => {
    expect(nextCutoffIndex(14, cutoffs, start, 1)).toBe(32);
    expect(nextCutoffIndex(32, cutoffs, start, 1)).toBe(49);
  });

  it('dir −1 from a payday goes to the previous payday', () => {
    expect(nextCutoffIndex(14, cutoffs, start, -1)).toBe(0);
    expect(nextCutoffIndex(49, cutoffs, start, -1)).toBe(32);
  });

  it('dir −1 from mid-cutoff goes back to that cutoff’s payday', () => {
    expect(nextCutoffIndex(20, cutoffs, start, -1)).toBe(14);
  });

  it('stays put when there is no payday in that direction', () => {
    expect(nextCutoffIndex(0, cutoffs, start, -1)).toBe(0);
    expect(nextCutoffIndex(60, cutoffs, start, 1)).toBe(60);
    expect(nextCutoffIndex(3, [], start, 1)).toBe(3);
  });
});
