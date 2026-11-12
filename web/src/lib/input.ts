import { project } from './engine';
import type { EngineEvent, FxRate, Input, Item } from './engine-types';
import type { AppSettings, StoredItem } from './db';
import { daysBetween, todayLocal } from './dates';

export { todayLocal };

/** Days after the as-of date before Lantaw asks the user to update the balance. */
const STALE_AFTER_DAYS = 7;

/**
 * Builds the engine `Input` from what is stored on the device. App-only fields
 * (theme, timestamps, ...) are dropped so only engine fields cross into WASM,
 * and every array is copied so the engine call can't alias app state.
 */
export function buildInput(
  s: AppSettings,
  items: StoredItem[],
  holidays: string[],
  fx: FxRate[],
  today: string,
): Input {
  return {
    today,
    settings: {
      balance: s.balance,
      balanceAsOf: s.balanceAsOf,
      safetyBuffer: s.safetyBuffer,
      horizonMonths: s.horizonMonths,
      cardFxFeePct: s.cardFxFeePct,
      paidOnAsOf: [...s.paidOnAsOf],
    },
    items: items.map(toEngineItem),
    holidays: [...holidays],
    fx: fx.map((r) => ({ currency: r.currency, phpPerUnit: r.phpPerUnit, asOf: r.asOf })),
  };
}

function toEngineItem(i: StoredItem): Item {
  return {
    id: i.id,
    name: i.name,
    kind: i.kind,
    amount: i.amount,
    currency: i.currency,
    schedule: i.schedule,
    businessDay: i.businessDay,
    included: i.included,
    paidFrom: i.paidFrom,
  };
}

/** True when `today` is more than 7 days after the balance's as-of date. */
export function isBalanceStale(asOf: string, today: string): boolean {
  return daysBetween(asOf, today) > STALE_AFTER_DAYS;
}

/**
 * Events dated on `balanceAsOf`, for the "Already in your balance?" checklist.
 * Runs the projection with `paidOnAsOf` cleared, so items the user already
 * ticked still appear (ticked) instead of vanishing from the list.
 */
export function dueOnAsOf(input: Input): EngineEvent[] {
  const asOf = input.settings.balanceAsOf;
  const p = project({ ...input, settings: { ...input.settings, paidOnAsOf: [] } });
  return p.events.filter((e) => e.date === asOf);
}
