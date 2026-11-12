import type { StoredItem } from './db';
import type { IsoDate, Projection } from './engine-types';

export type PlanLane = {
  itemId: string;
  name: string;
  kind: 'installment' | 'paluwagan';
  first: IsoDate;
  last: IsoDate;
  /** Paluwagan only: the date of the payout (the one inflow event). */
  payout?: IsoDate;
  /** False for what-if items, which are drawn but not counted. */
  included: boolean;
};

/**
 * One lane per installment or paluwagan that has at least one event in the
 * projection window. `first`/`last` come from those events; the order follows
 * `items`.
 */
export function planLanes(p: Projection, items: StoredItem[]): PlanLane[] {
  const byItem = new Map<string, Projection['events']>();
  for (const e of p.events) {
    const list = byItem.get(e.itemId);
    if (list) list.push(e);
    else byItem.set(e.itemId, [e]);
  }

  const lanes: PlanLane[] = [];
  for (const it of items) {
    const type = it.kind.type;
    if (type !== 'installment' && type !== 'paluwagan') continue;
    const evs = byItem.get(it.id);
    if (!evs || evs.length === 0) continue;

    let first = evs[0].date;
    let last = evs[0].date;
    for (const e of evs) {
      if (e.date < first) first = e.date;
      if (e.date > last) last = e.date;
    }
    const lane: PlanLane = { itemId: it.id, name: it.name, kind: type, first, last, included: it.included };
    if (type === 'paluwagan') {
      const payout = evs.find((e) => e.centavos > 0);
      if (payout) lane.payout = payout.date;
    }
    lanes.push(lane);
  }
  return lanes;
}
