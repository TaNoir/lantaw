import type { StoredItem } from './db';
import type { IsoDate, Projection } from './engine-types';
import { formatMonthYearLong, formatShort } from './dates';

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
  /**
   * The very last payment is inside the window (the engine's finish line), so
   * `last` is the last hulog. False: payments go on past the window's end.
   */
  finishes: boolean;
};

/**
 * One lane per installment or paluwagan that has at least one event in the
 * projection window. `first`/`last` come from those events; the order follows
 * `items`. A lane `finishes` when the projection has a finish line for it.
 * The engine only gives finish lines for counted items, so the caller passes
 * `whatIfFinished` (ids from a run with the what-ifs counted) for the rest.
 */
export function planLanes(p: Projection, items: StoredItem[], whatIfFinished: ReadonlySet<string> = new Set()): PlanLane[] {
  const byItem = new Map<string, Projection['events']>();
  for (const e of p.events) {
    const list = byItem.get(e.itemId);
    if (list) list.push(e);
    else byItem.set(e.itemId, [e]);
  }
  const finished = new Set(p.finishLines.map((f) => f.itemId));

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
    const finishes = it.included ? finished.has(it.id) : whatIfFinished.has(it.id);
    const lane: PlanLane = { itemId: it.id, name: it.name, kind: type, first, last, included: it.included, finishes };
    if (type === 'paluwagan') {
      const payout = evs.find((e) => e.centavos > 0);
      if (payout) lane.payout = payout.date;
    }
    lanes.push(lane);
  }
  return lanes;
}

/**
 * The lane's line of text: "Last hulog Aug 15, 2027" when it finishes in the
 * window, else "Continues past Nov 2027" (`windowLast` is the window's last
 * day). A paluwagan starts with its payout.
 */
export function laneNote(l: PlanLane, windowLast: IsoDate, refYear: number): string {
  const end = l.finishes ? `last hulog ${formatShort(l.last, refYear)}` : `continues past ${formatMonthYearLong(windowLast)}`;
  if (l.kind === 'paluwagan' && l.payout) return `Payout ${formatShort(l.payout, refYear)} · ${end}`;
  return end.charAt(0).toUpperCase() + end.slice(1);
}
