import type { Cutoff } from './engine-types';
import { daysBetween } from './dates';

export type Point = { i: number; v: number };

/**
 * Reduces a daily series to at most `maxPoints` points for drawing.
 *
 * The first and last days are always kept so the line spans the full width.
 * The days between are split into equal buckets and each bucket keeps its
 * minimum and its maximum (in index order), so the gipit point and every peak
 * survive. Output is in strictly increasing index order.
 */
export function downsample(days: number[], maxPoints: number): Point[] {
  const n = days.length;
  if (n <= maxPoints) return days.map((v, i) => ({ i, v }));

  const first: Point = { i: 0, v: days[0] };
  const last: Point = { i: n - 1, v: days[n - 1] };
  const buckets = Math.floor((maxPoints - 2) / 2);
  if (buckets < 1) return maxPoints >= 2 ? [first, last] : [first];

  const out: Point[] = [first];
  const innerStart = 1;
  const innerLen = n - 2;
  for (let b = 0; b < buckets; b++) {
    const from = innerStart + Math.floor((b * innerLen) / buckets);
    const to = innerStart + Math.floor(((b + 1) * innerLen) / buckets);
    if (to <= from) continue;
    let lo = from;
    let hi = from;
    for (let k = from + 1; k < to; k++) {
      if (days[k] < days[lo]) lo = k;
      if (days[k] > days[hi]) hi = k;
    }
    if (lo === hi) {
      out.push({ i: lo, v: days[lo] });
    } else {
      const [a, c] = lo < hi ? [lo, hi] : [hi, lo];
      out.push({ i: a, v: days[a] }, { i: c, v: days[c] });
    }
  }
  out.push(last);
  return out;
}

const r2 = (x: number) => String(Math.round(x * 100) / 100);

/**
 * SVG path strings for a balance line and the area under it.
 *
 * x runs from 0 (first point) to `width` (last point's index); y puts `max` at
 * the top (0) and `min` at the bottom (`height`). A flat range (`min === max`)
 * draws through the middle. The area closes along the bottom edge.
 */
export function areaPath(
  points: Point[],
  width: number,
  height: number,
  min: number,
  max: number,
): { line: string; area: string } {
  if (points.length === 0) return { line: '', area: '' };
  const i0 = points[0].i;
  const span = points[points.length - 1].i - i0;
  const range = max - min;
  const x = (i: number) => (span === 0 ? 0 : ((i - i0) / span) * width);
  const y = (v: number) => (range === 0 ? height / 2 : height - ((v - min) / range) * height);

  let line = '';
  for (let k = 0; k < points.length; k++) {
    line += `${k === 0 ? 'M' : 'L'}${r2(x(points[k].i))},${r2(y(points[k].v))}`;
  }
  const xEnd = r2(x(points[points.length - 1].i));
  const xStart = r2(x(i0));
  const area = `${line}L${xEnd},${r2(height)}L${xStart},${r2(height)}Z`;
  return { line, area };
}

/**
 * Day index of the next (`dir` 1) or previous (`dir` −1) cutoff payday,
 * relative to `dayIndex`. Stays at `dayIndex` when there is none that way.
 */
export function nextCutoffIndex(dayIndex: number, cutoffs: Cutoff[], start: string, dir: 1 | -1): number {
  let best = dayIndex;
  if (dir === 1) {
    for (const c of cutoffs) {
      const idx = daysBetween(start, c.payday);
      if (idx > dayIndex) return idx;
    }
  } else {
    for (const c of cutoffs) {
      const idx = daysBetween(start, c.payday);
      if (idx >= dayIndex) break;
      best = idx;
    }
  }
  return best;
}
