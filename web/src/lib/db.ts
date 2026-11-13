import Dexie, { type EntityTable } from 'dexie';
import type { Item, Settings } from './engine-types';

export type StoredItem = Item & { createdAt: number; updatedAt: number };

export type AppSettings = Settings & {
  davaoHolidays: boolean;
  customHolidays: string[];
  /** Optional names for custom holidays, by date (display only). */
  holidayNames: Record<string, string>;
  theme: 'system' | 'dark' | 'light';
  onboarded: boolean;
  isSample: boolean;
};

export interface CacheRow {
  key: string;
  value: unknown;
  fetchedAt: number;
}

interface SettingsRow {
  key: string;
  value: AppSettings;
}

export const db = new Dexie('lantaw') as Dexie & {
  items: EntityTable<StoredItem, 'id'>;
  settings: EntityTable<SettingsRow, 'key'>;
  cache: EntityTable<CacheRow, 'key'>;
};

db.version(1).stores({
  items: 'id, updatedAt',
  settings: 'key',
  cache: 'key',
});

/**
 * A plain deep copy for IndexedDB. Values often come from Svelte 5 `$state`,
 * which are Proxies that structured cloning rejects (DataCloneError). All
 * stored data is JSON-safe (strings, numbers, booleans, null, arrays, objects),
 * so a JSON round trip is exact. Every write in this module goes through it.
 */
export function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Device-local calendar date as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function DEFAULT_SETTINGS(today: string): AppSettings {
  return {
    balance: '0',
    balanceAsOf: today,
    safetyBuffer: '3000',
    horizonMonths: 12,
    cardFxFeePct: '0',
    paidOnAsOf: [],
    davaoHolidays: true,
    customHolidays: [],
    holidayNames: {},
    theme: 'system',
    onboarded: false,
    isSample: false,
  };
}

export async function getSettings(): Promise<AppSettings> {
  const row = await db.settings.get('app');
  return row ? row.value : DEFAULT_SETTINGS(localToday());
}

export async function saveSettings(s: AppSettings): Promise<void> {
  await db.settings.put({ key: 'app', value: toPlain(s) });
}

export async function listItems(): Promise<StoredItem[]> {
  return db.items.toArray();
}

export async function putItem(i: Item | StoredItem): Promise<void> {
  const now = Date.now();
  const existing = await db.items.get(i.id);
  await db.items.put(toPlain({ ...i, createdAt: existing?.createdAt ?? now, updatedAt: now }));
}

/** Replaces every item and the settings in one transaction (the sample budget). */
export async function replaceAll(s: AppSettings, items: StoredItem[]): Promise<void> {
  const plainSettings = toPlain(s);
  const plainItems = toPlain(items);
  await db.transaction('rw', db.items, db.settings, async () => {
    await db.items.clear();
    await db.settings.put({ key: 'app', value: plainSettings });
    await db.items.bulkPut(plainItems);
  });
}

/** Deletes every item (leftovers from an unfinished first run). */
export async function clearItems(): Promise<void> {
  await db.items.clear();
}

/** Writes a cache row (holidays, FX rates). */
export async function putCache(key: string, value: unknown): Promise<void> {
  await db.cache.put({ key, value: toPlain(value), fetchedAt: Date.now() });
}

export async function deleteItem(id: string): Promise<void> {
  await db.items.delete(id);
}

export async function clearAll(): Promise<void> {
  await db.transaction('rw', db.items, db.settings, db.cache, async () => {
    await Promise.all([db.items.clear(), db.settings.clear(), db.cache.clear()]);
  });
}

export async function requestPersist(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
