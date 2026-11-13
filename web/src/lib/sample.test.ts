import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { initEngineSync, project } from './engine';
import type { Input } from './engine-types';
import { addDays } from './dates';
import { toCentavos } from './money';
import sampleJson from './sample/sample-budget.json';

const sample = sampleJson as unknown as Input;

beforeAll(() => {
  initEngineSync(readFileSync('src/lib/wasm-pkg/lantaw_engine_bg.wasm'));
});

// The sample budget is what "Try a sample budget" loads, so it has to tell a
// story: a tight Jan–Feb after Pasko and tuition, recovering as hulog finish,
// and a laptop what-if that would sink February.
describe('sample budget story', () => {
  it('has its gipit day in Jan–Feb 2027, below the buffer but not below zero', () => {
    const p = project(sample);
    const g = p.gipit!;
    expect(g.date >= '2027-01-01' && g.date <= '2027-02-28').toBe(true);
    expect(g.centavos).toBeGreaterThanOrEqual(0);
    expect(g.centavos).toBeLessThan(toCentavos(sample.settings.safetyBuffer));
    expect(p.firstBelowZero).toBeNull();
  });

  it('ends the year modestly higher than it starts', () => {
    const p = project(sample);
    const gain = p.days[p.days.length - 1] - toCentavos(sample.settings.balance);
    expect(gain).toBeGreaterThanOrEqual(1_000_000);
    expect(gain).toBeLessThanOrEqual(4_000_000);
  });

  it('goes below zero in February only with the BPI laptop what-if', () => {
    const p = project(sample);
    expect(sample.items.find((i) => i.id === 'bpi-0-laptop')?.included).toBe(false);
    const w = p.whatIfDays!;
    const firstNeg = w.findIndex((c) => c < 0);
    expect(firstNeg).toBeGreaterThanOrEqual(0);
    expect(addDays(p.start, firstNeg).slice(0, 7)).toBe('2027-02');
  });
});
