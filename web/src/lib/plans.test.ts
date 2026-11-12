import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { initEngineSync, project } from './engine';
import type { Input, Projection } from './engine-types';
import type { StoredItem } from './db';
import { planLanes } from './plans';
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
});
