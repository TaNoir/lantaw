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
import type { EngineEvent, FxRate, Input, Item, Projection } from './engine-types';
import {
  DEFAULT_SETTINGS,
  clearAll,
  clearItems,
  db,
  deleteItem as dbDeleteItem,
  getSettings,
  listItems,
  putItem,
  replaceAll,
  requestPersist,
  saveSettings as dbSaveSettings,
  toPlain,
  type AppSettings,
  type StoredItem,
} from './db';
import { getCachedRate, getRate, holidayDates, holidayDatesCached, refreshRate, setManualRate } from './apis';
import type { BackupData } from './backup';
import { buildInput, dueOnAsOf, todayLocal } from './input';
import { rebaseSample } from './items';
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
  /** Settings and items have been read from storage (so `onboarded` is known). */
  storedLoaded = $state(false);

  #engineReady = false;
  #holidays: string[] = [];
  #holidayKey = '';
  #fx: FxRate[] = [];
  #fxMissing: string | null = null;
  /** When each holiday key / currency was last sent to the network (ms). */
  #holidayTried = new Map<string, number>();
  #fxTried = new Map<string, number>();
  #seq = 0;
  /** The running load(); first-run actions wait for it before writing. */
  #loading: Promise<void> = Promise.resolve();

  /** Day index of today in the current projection, clamped into range. */
  get todayIndex(): number {
    const p = this.projection;
    if (!p || p.days.length === 0) return 0;
    return clamp(daysBetween(p.start, this.today), 0, p.days.length - 1);
  }

  /**
   * What to show: first run while the user hasn't finished onboarding (whatever
   * the hash says), otherwise the hash route. `#/first-run` after onboarding
   * is just the Timeline.
   */
  get view(): Route {
    if (this.showFirstRun) return 'first-run';
    return this.route === 'first-run' ? 'timeline' : this.route;
  }

  /** First run, once storage says the user isn't onboarded (never while it failed to start). */
  get showFirstRun(): boolean {
    return this.storedLoaded && this.status !== 'failed' && !this.settings.onboarded;
  }

  load(): Promise<void> {
    this.#loading = this.#load();
    return this.#loading;
  }

  async #load(): Promise<void> {
    this.status = 'loading';
    this.today = todayLocal();
    // Read storage while the engine loads, so first run (or the forecast
    // shell) is known without waiting for the WASM.
    const stored = this.#loadStored();
    stored.catch(() => {}); // handled below; avoids an unhandled rejection if the engine fails first
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
      await stored;
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
        if ((await db.items.count()) === 0) await this.#writeSample();
        const url = new URL(location.href);
        url.searchParams.delete('demo');
        history.replaceState(null, '', url);
      }
    }

    const [stored, items] = await Promise.all([getSettings(), listItems()]);
    // Stored values win; fields added in later versions get their defaults.
    this.settings = { ...DEFAULT_SETTINGS(this.today), ...stored };
    this.items = [...items].sort(byCreated);
    this.storedLoaded = true;
  }

  /**
   * Replaces whatever is stored with the sample budget moved to today. The
   * sample's USD rate is cached only when there's no rate yet, so a fetched
   * rate is never overwritten.
   */
  async #writeSample(): Promise<{ settings: AppSettings; items: StoredItem[] }> {
    const sample = (await import('./sample/sample-budget.json')).default as unknown as Input;
    const { settings, items } = rebaseSample(sample, this.today);
    await replaceAll(settings, items);
    for (const r of sample.fx) {
      if (!(await getCachedRate(r.currency))) await setManualRate(r.currency, r.phpPerUnit, r.asOf);
    }
    return { settings, items };
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

  /**
   * The engine input the current projection was built from (same settings,
   * items, cached holidays and FX), for Kaya ba?. Null before the engine is
   * ready or while an exchange rate is missing (`missingRate` says which).
   * Read it after `projection` changes: holidays and FX are not reactive.
   */
  currentInput(): Input | null {
    if (!this.#engineReady || this.#fxMissing) return null;
    return buildInput(this.settings, this.items, this.#holidays, this.#fx, this.today);
  }

  // ---- writes: persist, then refresh inputs and recompute ----

  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    // Plain data in memory too: `patch` may hold `$state` proxies from a form.
    const next = toPlain({ ...this.settings, ...patch });
    await dbSaveSettings(next);
    this.settings = next;
    await this.#sync();
  }

  async saveItem(item: Item | StoredItem): Promise<void> {
    await this.saveItems([item]);
  }

  /** Saves several items (e.g. an item plus the income that lost the main-sweldo flag), then recomputes once. */
  async saveItems(list: (Item | StoredItem)[]): Promise<void> {
    const wasEmpty = this.items.length === 0;
    for (const item of list) await putItem(item);
    this.items = [...(await listItems())].sort(byCreated);
    // Ask the browser to keep the data once there is something worth keeping.
    if (wasEmpty && this.items.length > 0) void requestPersist();
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

  /**
   * The Settings refresh button: asks Frankfurter for `currency` now (even if
   * the cached rate is fresh) and recomputes when a new rate came back.
   */
  async refreshRate(currency: string): Promise<{ rate: FxRate | null; fresh: boolean }> {
    const out = await refreshRate(currency);
    if (out.fresh) await this.#sync();
    return out;
  }

  // ---- backup ----

  /** What a backup holds: plain copies of the settings and items (never the cache). */
  backupData(): BackupData {
    return toPlain({ settings: this.settings, items: this.items });
  }

  /**
   * Stores an imported backup (already merged or not, see `prepareImport`) in
   * one transaction, then shows its forecast. Holidays and rates are read
   * afresh because the custom holidays and currencies may have changed.
   */
  async importData(next: BackupData): Promise<void> {
    await this.#loading;
    const plain = toPlain(next);
    await replaceAll(plain.settings, plain.items);
    this.settings = plain.settings;
    this.items = [...plain.items].sort(byCreated);
    this.#holidayKey = '';
    this.#holidayTried.clear();
    this.#fxTried.clear();
    if (this.items.length > 0) void requestPersist();
    await this.#sync();
    this.selectedDay = this.todayIndex;
  }

  /** Settings → Erase everything: wipes the device, back to the first-run intro. */
  async eraseEverything(): Promise<void> {
    await this.#loading;
    await this.clearSample();
  }

  // ---- first run and the sample budget ----

  /** "Try a sample budget": stores the sample (marked `isSample`) and shows its forecast. */
  async loadSample(): Promise<void> {
    await this.#loading;
    const { settings, items } = await this.#writeSample();
    this.settings = settings;
    this.items = [...items].sort(byCreated);
    await this.#sync();
    this.selectedDay = this.todayIndex;
  }

  /**
   * Start (or the sample) on the intro while not onboarded: removes items left
   * from an unfinished first run (only quick-add items can be saved before the
   * end), so onboarding always starts clean and never duplicates them.
   */
  async startFirstRun(): Promise<void> {
    await this.#loading;
    if (this.settings.onboarded || this.items.length === 0) return;
    await clearItems();
    this.items = [];
    await this.#sync();
  }

  /** "Clear" on the sample banner: erases everything on the device, back to first run. */
  async clearSample(): Promise<void> {
    await clearAll();
    this.settings = DEFAULT_SETTINGS(this.today);
    this.items = [];
    this.projection = null;
    this.selectedDay = 0;
    // The caches went too: read holidays and rates afresh.
    this.#holidayKey = '';
    this.#holidayTried.clear();
    this.#fxTried.clear();
    await this.#sync();
  }

  /**
   * Finishes first run: writes the sweldo items, then the settings with
   * `onboarded` set (which swaps first run for the forecast), and asks the
   * browser to keep the data.
   */
  async finishFirstRun(patch: Partial<AppSettings>, items: StoredItem[]): Promise<void> {
    await this.#loading;
    for (const item of items) await putItem(item);
    const next: AppSettings = toPlain({ ...this.settings, ...patch, onboarded: true, isSample: false });
    await dbSaveSettings(next);
    this.items = [...(await listItems())].sort(byCreated);
    this.settings = next;
    void requestPersist();
    await this.#sync();
    this.selectedDay = this.todayIndex;
  }

  /**
   * Events dated on `settings.balanceAsOf` for the "Already in your balance?"
   * checklist, for settings and items that may not be saved yet. Uses cached
   * or bundled holidays and cached rates only; a foreign-currency item with no
   * rate yet is left off the list rather than failing it.
   */
  async dueOnAsOfFor(settings: AppSettings, items: StoredItem[]): Promise<EngineEvent[]> {
    await this.#loading;
    if (!this.#engineReady) return [];
    const holidays = await holidayDatesCached(settings, horizonYears(settings));
    const fx: FxRate[] = [];
    for (const cur of currenciesOf(items)) {
      const rate = await getCachedRate(cur);
      if (rate) fx.push(rate);
    }
    const known = new Set(['PHP', ...fx.map((r) => r.currency.toUpperCase())]);
    const usable = items.filter((i) => known.has(i.currency.toUpperCase()));
    try {
      return dueOnAsOf(buildInput(settings, usable, holidays, fx, this.today));
    } catch {
      return [];
    }
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
