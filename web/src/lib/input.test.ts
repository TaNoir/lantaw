import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { initEngineSync, project } from './engine';
import type { Input } from './engine-types';
import type { AppSettings, StoredItem } from './db';
import { buildInput, dueOnAsOf, forecastItems, isBalanceStale, todayLocal } from './input';
import { EngineError } from './engine';
import sampleJson from './sample/sample-budget.json';

const sample = sampleJson as unknown as Input;

beforeAll(() => {
  initEngineSync(readFileSync('src/lib/wasm-pkg/lantaw_engine_bg.wasm'));
});

function appSettingsFrom(input: Input): AppSettings {
  return {
    ...input.settings,
    davaoHolidays: true,
    customHolidays: ['2027-01-02'],
    holidayNames: {},
    theme: 'dark',
    onboarded: true,
    isSample: true,
  };
}

function storedItemsFrom(input: Input): StoredItem[] {
  return input.items.map((i, n) => ({ ...i, createdAt: 1000 + n, updatedAt: 2000 + n }));
}

describe('isBalanceStale', () => {
  it('is true only when today is more than 7 days after the as-of date', () => {
    expect(isBalanceStale('2026-11-01', '2026-11-09')).toBe(true);
    expect(isBalanceStale('2026-11-02', '2026-11-09')).toBe(false);
    expect(isBalanceStale('2026-11-09', '2026-11-09')).toBe(false);
  });

  it('works across month and year ends', () => {
    expect(isBalanceStale('2026-12-24', '2027-01-01')).toBe(true);
    expect(isBalanceStale('2026-12-25', '2027-01-01')).toBe(false);
  });

  it('is false when the as-of date is in the future', () => {
    expect(isBalanceStale('2026-12-01', '2026-11-13')).toBe(false);
  });
});

describe('todayLocal', () => {
  it('returns the device-local date as YYYY-MM-DD', () => {
    const d = new Date();
    const want = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(todayLocal()).toBe(want);
  });
});

describe('buildInput', () => {
  it('rebuilds the sample Input exactly from stored settings and items', () => {
    const input = buildInput(appSettingsFrom(sample), storedItemsFrom(sample), sample.holidays, sample.fx, sample.today);
    expect(input).toEqual(sample);
  });

  it('drops app-only fields so only engine fields cross the boundary', () => {
    const input = buildInput(appSettingsFrom(sample), storedItemsFrom(sample), sample.holidays, sample.fx, sample.today);
    expect(Object.keys(input.settings).sort()).toEqual(
      ['balance', 'balanceAsOf', 'cardFxFeePct', 'horizonMonths', 'paidOnAsOf', 'safetyBuffer'].sort(),
    );
    for (const item of input.items) {
      expect(item).not.toHaveProperty('createdAt');
      expect(item).not.toHaveProperty('updatedAt');
    }
  });

  it('produces an Input whose projection matches the fixture projection', () => {
    const input = buildInput(appSettingsFrom(sample), storedItemsFrom(sample), sample.holidays, sample.fx, sample.today);
    const viaJson = JSON.parse(JSON.stringify(input)) as Input;
    expect(project(viaJson)).toEqual(project(sample));
  });

  it('does not share arrays with the stored settings', () => {
    const s = { ...appSettingsFrom(sample), paidOnAsOf: ['sweldo'] };
    const input = buildInput(s, [], [], [], sample.today);
    input.settings.paidOnAsOf.push('rent');
    expect(s.paidOnAsOf).toEqual(['sweldo']);
  });
});

describe('dueOnAsOf', () => {
  it('lists every event dated on balanceAsOf', () => {
    const ids = dueOnAsOf(sample).map((e) => e.itemId);
    expect(ids).toContain('sweldo');
    expect(ids).toContain('spaylater');
    for (const e of dueOnAsOf(sample)) expect(e.date).toBe(sample.settings.balanceAsOf);
  });

  it('ignores paidOnAsOf, so ticked items stay on the checklist', () => {
    const ticked: Input = { ...sample, settings: { ...sample.settings, paidOnAsOf: ['sweldo', 'spaylater'] } };
    const ids = dueOnAsOf(ticked).map((e) => e.itemId);
    expect(ids).toContain('sweldo');
    expect(ids).toContain('spaylater');
    expect(ticked.settings.paidOnAsOf).toEqual(['sweldo', 'spaylater']);
  });
});

describe('forecastItems (a missing rate only blocks what the engine needs)', () => {
  const stored = () => storedItemsFrom(sample);
  const sgd = (over: Partial<StoredItem>): StoredItem => ({
    ...stored().find((i) => i.id === 'chatgpt')!,
    id: 'sgd-thing',
    name: 'SGD thing',
    currency: 'SGD',
    ...over,
  });
  const run = (items: StoredItem[]) =>
    project(buildInput(appSettingsFrom(sample), forecastItems(items, sample.fx), sample.holidays, sample.fx, sample.today));

  it('leaves out a what-if foreign item with no rate, so the forecast still runs', () => {
    const items = [...stored(), sgd({ included: false })];
    expect(forecastItems(items, sample.fx).some((i) => i.id === 'sgd-thing')).toBe(false);
    expect(run(items).days.length).toBeGreaterThan(0);
  });

  it('keeps a what-if foreign item that has a rate, and every PHP item', () => {
    const items = [...stored(), sgd({ included: false, currency: 'usd' })];
    expect(forecastItems(items, sample.fx).map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it('keeps a counted foreign item with no rate: the engine reports MISSING_FX for it', () => {
    const items = [...stored(), sgd({ included: true })];
    expect(forecastItems(items, sample.fx).some((i) => i.id === 'sgd-thing')).toBe(true);
    let err: unknown;
    try {
      run(items);
    } catch (e) {
      err = e;
    }
    const parsed = err instanceof EngineError ? err : EngineError.parse(err);
    expect(parsed.code).toBe('MISSING_FX');
    expect(parsed.detail).toBe('SGD');
  });

  it('a counted foreign item with nothing in the window needs no rate', () => {
    const items = [
      ...stored(),
      sgd({ included: true, schedule: { start: '2020-01-01', end: '2020-02-01', every: { type: 'monthly', day: 1 } } }),
    ];
    expect(run(items).days.length).toBeGreaterThan(0);
  });
});
