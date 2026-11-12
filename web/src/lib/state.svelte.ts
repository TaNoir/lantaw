// App-wide state: what is stored, the current projection, the route and the
// scrubber position. Svelte 5 runes in a class, exported as one `app` object.
//
// Data flow: load() / a write  ->  #sync(): fetch holidays + FX (async, cached)
// -> recompute() (sync engine call). Scrubbing only changes `selectedDay`; it
// never recomputes.

import { EngineError, initEngine, project } from './engine';
import type { FxRate, Input, Item, Projection } from './engine-types';
import {
  DEFAULT_SETTINGS,
  db,
  deleteItem as dbDeleteItem,
  getSettings,
  listItems,
  putItem,
  saveSettings as dbSaveSettings,
  type AppSettings,
  type StoredItem,
} from './db';
import { getRate, holidayDates, setManualRate } from './apis';
import { buildInput, todayLocal } from './input';
import { daysBetween, yearOf } from './dates';

export type Route = 'timeline' | 'cutoffs' | 'plans' | 'kaya' | 'items' | 'settings' | 'first-run';

export const ROUTES: readonly Route[] = ['timeline', 'cutoffs', 'plans', 'kaya', 'items', 'settings', 'first-run'];

/** `#/plans` -> 'plans'. Anything unknown falls back to the Timeline. */
export function parseRoute(hash: string): Route {
  const m = /^#\/([a-z-]+)/.exec(hash);
  const r = m?.[1] as Route | undefined;
  return r && ROUTES.includes(r) ? r : 'timeline';
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Every calendar year the forecast window touches (as-of year .. horizon-end year). */
function horizonYears(s: AppSettings): number[] {
  const y = yearOf(s.balanceAsOf);
  const m = Number(s.balanceAsOf.slice(5, 7));
  const endYear = y + Math.floor((m - 1 + s.horizonMonths) / 12);
  const out: number[] = [];
  for (let k = y; k <= endYear; k++) out.push(k);
  return out;
}

/** How long a rate looked up in this session is reused before asking again. */
const FX_SESSION_MS = 60 * 60 * 1000;

const byCreated = (a: StoredItem, b: StoredItem) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);

class AppState {
  // Raw state: these are replaced wholesale, never mutated, so they stay plain
  // objects (IndexedDB and the WASM bridge both need plain data, and the large
  // projection arrays are not worth proxying).
  settings = $state.raw<AppSettings>(DEFAULT_SETTINGS(todayLocal()));
  items = $state.raw<StoredItem[]>([]);
  projection = $state.raw<Projection | null>(null);
  error = $state.raw<EngineError | null>(null);

  route = $state<Route>(typeof location === 'undefined' ? 'timeline' : parseRoute(location.hash));
  selectedDay = $state(0);
  missingRate = $state<string | null>(null);
  status = $state<'loading' | 'ready' | 'failed'>('loading');
  today = $state(todayLocal());

  #engineReady = false;
  #holidays: string[] = [];
  #holidayKey = '';
  #fx: FxRate[] = [];
  #fxMissing: string | null = null;
  /** Rates already looked up this session, so a slow network can't stall every write. */
  #fxSession = new Map<string, { rate: FxRate; at: number }>();
  #seq = 0;

  /** Day index of today in the current projection, clamped into range. */
  get todayIndex(): number {
    const p = this.projection;
    if (!p || p.days.length === 0) return 0;
    return clamp(daysBetween(p.start, this.today), 0, p.days.length - 1);
  }

  async load(): Promise<void> {
    this.status = 'loading';
    this.today = todayLocal();
    try {
      await initEngine();
      this.#engineReady = true;
    } catch (e) {
      this.error = new EngineError('INTERNAL', `engine failed to load: ${e instanceof Error ? e.message : String(e)}`);
      this.status = 'failed';
      return;
    }

    if (import.meta.env.DEV) {
      // DEV ONLY: `?demo` seeds the sample budget once, for checking by hand.
      if (new URLSearchParams(location.search).has('demo')) {
        if ((await db.items.count()) === 0) {
          const sample = (await import('./sample/sample-budget.json')).default as unknown as Input;
          await dbSaveSettings({
            ...DEFAULT_SETTINGS(this.today),
            ...sample.settings,
            onboarded: true,
            isSample: true,
          });
          await db.items.bulkPut(sample.items.map((it, n) => ({ ...it, createdAt: n + 1, updatedAt: n + 1 })));
          for (const r of sample.fx) await setManualRate(r.currency, r.phpPerUnit, r.asOf);
        }
        const url = new URL(location.href);
        url.searchParams.delete('demo');
        history.replaceState(null, '', url);
      }
    }

    const [stored, items] = await Promise.all([getSettings(), listItems()]);
    // Stored values win; fields added in later versions get their defaults.
    this.settings = { ...DEFAULT_SETTINGS(this.today), ...stored };
    this.items = [...items].sort(byCreated);
    await this.#sync();
    this.selectedDay = this.todayIndex;
    this.status = 'ready';
  }

  /**
   * Runs the engine on the current data, synchronously. A missing exchange
   * rate sets `missingRate` and keeps the previous projection on screen.
   */
  recompute(): void {
    if (!this.#engineReady) return;
    if (this.#fxMissing) {
      this.missingRate = this.#fxMissing;
      return;
    }
    try {
      const prev = this.projection;
      const next = project(buildInput(this.settings, this.items, this.#holidays, this.#fx, this.today));
      // Keep the same calendar date selected when the start date moves.
      let sel = this.selectedDay;
      if (prev && prev.start !== next.start) sel += daysBetween(next.start, prev.start);
      this.projection = next;
      this.selectedDay = clamp(sel, 0, Math.max(0, next.days.length - 1));
      this.error = null;
      this.missingRate = null;
    } catch (e) {
      const err = e instanceof EngineError ? e : EngineError.parse(e);
      if (err.code === 'MISSING_FX') this.missingRate = err.detail;
      else this.error = err;
    }
  }

  // ---- writes: persist, then refresh inputs and recompute ----

  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    const next = { ...this.settings, ...patch };
    await dbSaveSettings(next);
    this.settings = next;
    await this.#sync();
  }

  async saveItem(item: Item | StoredItem): Promise<void> {
    await putItem(item);
    this.items = [...(await listItems())].sort(byCreated);
    await this.#sync();
  }

  async deleteItem(id: string): Promise<void> {
    await dbDeleteItem(id);
    this.items = this.items.filter((i) => i.id !== id);
    await this.#sync();
  }

  /** Saves a hand-typed PHP-per-unit rate (decimal string) and recomputes. */
  async saveManualRate(currency: string, phpPerUnit: string): Promise<void> {
    await setManualRate(currency, phpPerUnit, this.today);
    this.#fxSession.delete(currency.toUpperCase());
    await this.#sync();
  }

  // ---- routing (hash based: #/timeline, #/items, ...) ----

  navigate(r: Route): void {
    const hash = `#/${r}`;
    if (location.hash !== hash) location.hash = hash;
    this.route = r;
  }

  /** Starts listening to `hashchange`; returns the cleanup function. */
  startRouter(): () => void {
    const onHash = () => {
      this.route = parseRoute(location.hash);
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }

  /** Fetches holidays and FX for the current data (cached), then recomputes. */
  async #sync(): Promise<void> {
    const seq = ++this.#seq;
    const s = this.settings;
    const items = this.items;

    const years = horizonYears(s);
    const holidayKey = JSON.stringify([years, s.davaoHolidays, s.customHolidays]);
    const holidays = holidayKey === this.#holidayKey ? this.#holidays : await holidayDates(s, years);

    const currencies = [...new Set(items.map((i) => i.currency.toUpperCase()))].filter((c) => c !== 'PHP').sort();
    const fx: FxRate[] = [];
    let missing: string | null = null;
    for (const cur of currencies) {
      const memo = this.#fxSession.get(cur);
      const rate = memo && Date.now() - memo.at < FX_SESSION_MS ? memo.rate : await getRate(cur);
      if (rate) {
        fx.push(rate);
        if (rate !== memo?.rate) this.#fxSession.set(cur, { rate, at: Date.now() });
      } else {
        missing ??= cur;
      }
    }

    // A newer write started while we were waiting; let it finish instead.
    if (seq !== this.#seq) return;
    this.#holidays = holidays;
    this.#holidayKey = holidayKey;
    this.#fx = fx;
    this.#fxMissing = missing;
    this.recompute();
  }
}

export const app = new AppState();
