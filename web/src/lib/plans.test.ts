import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { initEngineSync, project } from './engine';
import type { Input, Projection } from './engine-types';
import type { StoredItem } from './db';
import { laneNote, planLanes } from './plans';
import sampleJson from './sample/sample-budget.json';

const sample = sampleJson as unknown as Input;
const items: StoredItem[] = sample.items.map((it, n) => ({ ...it, createdAt: n + 1, updatedAt: n + 1 }));

let proj: Projection;
beforeAll(() => {
  initEngineSync(readFileSync('src/lib/wasm-pkg/lantaw_engine_bg.wasm'));
  proj = project(sample);
});

describe('planLanes', () => {
  const lanes = () => planLanes(proj, items);
  const byId = (id: string) => lanes().find((l) => l.itemId === id);

  it('gives the Home Credit installment its last payment', () => {
    const l = byId('home-credit-phone')!;
    expect(l.kind).toBe('installment');
    expect(l.last).toBe('2027-08-15');
    expect(l.first <= l.last).toBe(true);
    expect(l.included).toBe(true);
  });

  it('marks the paluwagan payout', () => {
    const l = byId('paluwagan')!;
    expect(l.kind).toBe('paluwagan');
    expect(l.payout).toBe('2027-05-15');
  });

  it('keeps the what-if laptop, flagged as not included', () => {
    expect(byId('bpi-0-laptop')!.included).toBe(false);
  });

  it('only covers installments and paluwagans', () => {
    expect(byId('rent')).toBeUndefined();
    expect(byId('sweldo')).toBeUndefined();
    expect(lanes().every((l) => l.kind === 'installment' || l.kind === 'paluwagan')).toBe(true);
  });

  it('skips an item with no events', () => {
    const extra: StoredItem = { ...items.find((i) => i.id === 'spaylater')!, id: 'ghost', schedule: { start: '2000-01-01', end: '2000-01-02', every: { type: 'once' } } };
    expect(planLanes(proj, [...items, extra]).some((l) => l.itemId === 'ghost')).toBe(false);
  });

  it('marks a lane finished only when the engine has a finish line for it', () => {
    expect(byId('home-credit-phone')!.finishes).toBe(true);
    expect(byId('spaylater')!.finishes).toBe(true);
    expect(byId('paluwagan')!.finishes).toBe(true);
  });

  it('an installment that runs past the forecast window does not finish', () => {
    const long: StoredItem = {
      ...items.find((i) => i.id === 'home-credit-phone')!,
      id: 'long-loan',
      kind: { type: 'installment', totalPayments: 36, paidOverride: null },
    };
    const input = { ...sample, items: [...sample.items, long] };
    const l = planLanes(project(input), [...items, long]).find((x) => x.itemId === 'long-loan')!;
    expect(l.finishes).toBe(false);
    expect(l.last <= '2027-11-13').toBe(true);
  });

  it('a what-if lane (never in finishLines) finishes only when listed in `finished`', () => {
    expect(byId('bpi-0-laptop')!.finishes).toBe(false);
    expect(planLanes(proj, items, new Set(['bpi-0-laptop'])).find((l) => l.itemId === 'bpi-0-laptop')!.finishes).toBe(true);
  });
});

describe('laneNote', () => {
  const base = { itemId: 'x', name: 'X', kind: 'installment' as const, first: '2026-12-15', last: '2027-08-15', included: true };

  it('says "Last hulog" for a lane that finishes', () => {
    expect(laneNote({ ...base, finishes: true }, '2027-11-12', 2026)).toBe('Last hulog Aug 15, 2027');
  });

  it('says it continues past the window for a lane that does not finish', () => {
    expect(laneNote({ ...base, finishes: false }, '2027-11-12', 2026)).toBe('Continues past Nov 2027');
  });

  it('paluwagan: payout first, then the finish or "continues past"', () => {
    const pal = { ...base, kind: 'paluwagan' as const, payout: '2027-05-15' };
    expect(laneNote({ ...pal, finishes: true }, '2027-11-12', 2026)).toBe('Payout May 15, 2027 · last hulog Aug 15, 2027');
    expect(laneNote({ ...pal, finishes: false }, '2027-11-12', 2026)).toBe('Payout May 15, 2027 · continues past Nov 2027');
  });
});
