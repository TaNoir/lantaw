import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { initEngineSync, project } from './engine';
import type { Input } from './engine-types';
import type { AppSettings, StoredItem } from './db';
import { buildInput, dueOnAsOf, isBalanceStale, todayLocal } from './input';
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
