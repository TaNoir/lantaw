// App-wide state: what is stored, the current projection, the route and the
// scrubber position. Svelte 5 runes in a class, exported as one `app` object.
//
// Data flow: load() / a write  ->  #sync():
//   1. cache-first: holidays from the IndexedDB cache or the bundled list, FX
//      from the cache (no network), then recompute() (sync engine call), so
//      the forecast shows at once even on a hanging connection;
//   2. in the background: refresh holidays and FX from the network (at most
//      once per key / currency per hour) and, if that lands, run step 1 again.
// Scrubbing only changes `selectedDay`; it never recomputes.

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
import { getCachedRate, getRate, holidayDates, holidayDatesCached, setManualRate } from './apis';
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

/** How long before the same holidays or FX rate are asked of the network again. */
const REFRESH_MS = 60 * 60 * 1000;

/** Distinct non-PHP currencies among the items, upper-case and sorted. */
function currenciesOf(items: StoredItem[]): string[] {
  return [...new Set(items.map((i) => i.currency.toUpperCase()))].filter((c) => c !== 'PHP').sort();
}

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
  /** Why `status` is 'failed'. */
  failure = $state<'engine' | 'storage' | null>(null);
  today = $state(todayLocal());

  #engineReady = false;
  #holidays: string[] = [];
  #holidayKey = '';
  #fx: FxRate[] = [];
  #fxMissing: string | null = null;
  /** When each holiday key / currency was last sent to the network (ms). */
  #holidayTried = new Map<string, number>();
  #fxTried = new Map<string, number>();
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
      this.failure = 'engine';
      this.status = 'failed';
      return;
    }

    try {
      await this.#loadStored();
      await this.#sync();
    } catch (e) {
      this.error = new EngineError('INTERNAL', `storage unavailable: ${e instanceof Error ? e.message : String(e)}`);
      this.failure = 'storage';
      this.status = 'failed';
      return;
    }
    this.selectedDay = this.todayIndex;
    this.status = 'ready';
  }

  /** Reads settings and items from IndexedDB (plus the DEV-only `?demo` seed). */
  async #loadStored(): Promise<void> {
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
  }

  /**
   * Runs the engine on the current data, synchronously. A missing exchange
   * rate sets `missingRate` and keeps the previous projection on screen.
   */
  recompute(): void {
    if (!this.#engineReady) return;
    if (this.#fxMissing) {
      this.missingRate = this.#fxMissing;
      this.error = null;
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

  /**
   * Recomputes right away from cached or bundled data, then refreshes from the
   * network in the background. Resolves once the cache-first forecast is on
   * screen; never waits on the network.
   */
  async #sync(): Promise<void> {
    await this.#applyCached();
    // Best effort: offline or a failing cache read just keeps the cached forecast.
    this.#refreshFromNetwork().catch(() => {});
  }

  /** Step 1: holidays and FX without the network, then recompute. */
  async #applyCached(): Promise<void> {
    const seq = ++this.#seq;
    const s = this.settings;
    const years = horizonYears(s);
    const holidayKey = JSON.stringify([years, s.davaoHolidays, s.customHolidays]);
    const holidays = holidayKey === this.#holidayKey ? this.#holidays : await holidayDatesCached(s, years);

    const fx: FxRate[] = [];
    let missing: string | null = null;
    for (const cur of currenciesOf(this.items)) {
      const rate = await getCachedRate(cur);
      if (rate) fx.push(rate);
      else missing ??= cur;
    }

    // A newer write started while we were reading; let it finish instead.
    if (seq !== this.#seq) return;
    this.#holidays = holidays;
    this.#holidayKey = holidayKey;
    this.#fx = fx;
    this.#fxMissing = missing;
    this.recompute();
  }

  /**
   * Step 2: ask Nager.Date and Frankfurter (years and currencies in parallel),
   * at most once per hour per holiday key and currency, so a missing or
   * unreachable rate is not retried on every write. Both functions write the
   * IndexedDB cache; when anything came back, step 1 runs again to use it.
   */
  async #refreshFromNetwork(): Promise<void> {
    const now = Date.now();
    const due = (tried: Map<string, number>, key: string) => {
      const last = tried.get(key);
      if (last !== undefined && now - last < REFRESH_MS) return false;
      tried.set(key, now);
      return true;
    };

    const s = this.settings;
    const years = horizonYears(s);
    const tasks: Promise<boolean>[] = [];
    if (due(this.#holidayTried, JSON.stringify(years))) {
      tasks.push(holidayDates(s, years).then(() => true));
    }
    for (const cur of currenciesOf(this.items)) {
      if (due(this.#fxTried, cur)) tasks.push(getRate(cur).then((r) => r !== null));
    }
    if (tasks.length === 0) return;

    const results = await Promise.allSettled(tasks);
    if (!results.some((r) => r.status === 'fulfilled' && r.value)) return;
    this.#holidayKey = ''; // re-read holidays from the refreshed cache
    await this.#applyCached();
  }
}

export const app = new AppState();
