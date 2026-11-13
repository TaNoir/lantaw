// Encrypted backups: a `.lantaw` file holding `{ settings, items }` as JSON,
// encrypted by the engine (Argon2id + AES-256-GCM). JS supplies the random
// salt and nonce; the cache table (holidays, FX) is never exported.
//
// importBackup checks the file's shape and clamps the KDF parameters BEFORE
// any decrypt call, so a crafted file can't make Argon2 allocate gigabytes or
// run for minutes inside the WASM (which would hang or trap the page).

import { DEFAULT_SETTINGS, toPlain, type AppSettings, type StoredItem } from './db';
import { EngineError, decryptBackup, encryptBackup } from './engine';
import { ensureMainSweldo, isIsoDate, setMainSweldo, validateItem } from './items';
import { parseAmount, type ParseResult } from './money';
import { parseFeePct } from './settings';

export type BackupData = { settings: AppSettings; items: StoredItem[] };

export type Kdf = { m: number; t: number; p: number };

export type BackupFile = {
  format: 'lantaw-backup';
  version: 1;
  createdAt: string;
  kdf: { alg: 'argon2id'; m: number; t: number; p: number; salt: string /*b64*/ };
  nonce: string /*b64*/;
  ciphertext: string /*b64*/;
};

/** Argon2id defaults: 19 MiB, 2 passes, 1 lane (OWASP's minimum recommendation). */
export const DEFAULT_KDF: Kdf = { m: 19456, t: 2, p: 1 };

/**
 * What an imported file may ask for, so a crafted file can't stall a phone.
 * Memory is in KiB (64 MiB at most), and the total work m × t is at most 4×
 * the default (19456 × 2 × 4 = 155648). Argon2 itself also needs m ≥ 8 × p.
 * Anything outside is not a Lantaw file.
 */
export const KDF_LIMITS = { m: [8, 65_536], t: [1, 4], p: [1, 4], work: 155_648 } as const;

const FORMAT = 'lantaw-backup';
const VERSION = 1;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
/** Far above any real backup (a few hundred items is tens of KB); bigger files are refused unread. */
export const MAX_FILE_CHARS = 20 * 1024 * 1024;

/**
 * NOT_LANTAW: not our file, or its envelope is broken or out of range.
 * NEWER_VERSION: a later file format. WRONG_PASSPHRASE: the tag check failed
 * (a wrong password or a tampered ciphertext; AES-GCM can't tell them apart).
 * DAMAGED: it decrypted, but the data inside isn't valid Lantaw data.
 */
export type BackupImportCode = 'NOT_LANTAW' | 'NEWER_VERSION' | 'WRONG_PASSPHRASE' | 'DAMAGED';

export class BackupImportError extends Error {
  code: BackupImportCode;
  constructor(code: BackupImportCode, detail: string = code) {
    super(detail);
    this.name = 'BackupImportError';
    this.code = code;
  }
}

/** What to show the user for each import error. */
export const IMPORT_MESSAGES: Record<BackupImportCode, string> = {
  WRONG_PASSPHRASE: 'That password doesn’t open this backup, or the file is damaged.',
  DAMAGED: 'This backup is damaged and can’t be restored.',
  NOT_LANTAW: 'This file isn’t a Lantaw backup.',
  NEWER_VERSION: 'This backup is from a newer version of Lantaw. Update the app and try again.',
};

// ---------------------------------------------------------------- base64

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Strict standard base64 (padded, no whitespace), or null. */
function fromBase64(s: unknown): Uint8Array | null {
  if (typeof s !== 'string' || !B64.test(s)) return null;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- export

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `lantaw-backup-YYYY-MM-DD.lantaw` for the device's local date. */
export function backupFilename(now: Date = new Date()): string {
  return `lantaw-backup-${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}.lantaw`;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/**
 * Encrypts `{ settings, items }` (plain copies, nothing else) with
 * `passphrase`. Synchronous Argon2 inside: about a second at the defaults.
 */
export async function exportBackup(
  data: BackupData,
  passphrase: string,
  kdf: Kdf = DEFAULT_KDF,
): Promise<{ filename: string; blob: Blob }> {
  const plain = toPlain({ settings: data.settings, items: data.items });
  const plaintext = new TextEncoder().encode(JSON.stringify(plain));
  const salt = randomBytes(SALT_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = encryptBackup(plaintext, passphrase, salt, nonce, kdf.m, kdf.t, kdf.p);
  const now = new Date();
  const file: BackupFile = {
    format: FORMAT,
    version: VERSION,
    createdAt: now.toISOString(),
    kdf: { alg: 'argon2id', m: kdf.m, t: kdf.t, p: kdf.p, salt: toBase64(salt) },
    nonce: toBase64(nonce),
    ciphertext: toBase64(ciphertext),
  };
  return {
    filename: backupFilename(now),
    blob: new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
  };
}

// ---------------------------------------------------------------- import

const notLantaw = (why: string) => new BackupImportError('NOT_LANTAW', why);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inRange = (v: unknown, [lo, hi]: readonly [number, number]): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

type Parsed = { kdf: Kdf; salt: Uint8Array; nonce: Uint8Array; ciphertext: Uint8Array };

/** Checks the envelope (format, version, KDF clamp, byte lengths). Throws BackupImportError. */
function parseEnvelope(text: string): Parsed {
  if (text.length > MAX_FILE_CHARS) throw notLantaw('too large');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw notLantaw('not JSON');
  }
  if (!isObj(raw) || raw.format !== FORMAT) throw notLantaw('format');
  const v = raw.version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw notLantaw('version');
  if (v > VERSION) throw new BackupImportError('NEWER_VERSION');

  const k = raw.kdf;
  if (!isObj(k) || k.alg !== 'argon2id') throw notLantaw('kdf');
  if (!inRange(k.m, KDF_LIMITS.m) || !inRange(k.t, KDF_LIMITS.t) || !inRange(k.p, KDF_LIMITS.p)) {
    throw notLantaw('kdf params');
  }
  if (k.m < 8 * k.p || k.m * k.t > KDF_LIMITS.work) throw notLantaw('kdf params');

  const salt = fromBase64(k.salt);
  const nonce = fromBase64(raw.nonce);
  const ciphertext = fromBase64(raw.ciphertext);
  if (!salt || salt.length !== SALT_BYTES) throw notLantaw('salt');
  if (!nonce || nonce.length !== NONCE_BYTES) throw notLantaw('nonce');
  // AES-GCM output is at least the 16-byte tag.
  if (!ciphertext || ciphertext.length < 16) throw notLantaw('ciphertext');
  return { kdf: { m: k.m, t: k.t, p: k.p }, salt, nonce, ciphertext };
}

const isStr = (v: unknown): v is string => typeof v === 'string';

const damaged = (why: string) => new BackupImportError('DAMAGED', why);
const BUSINESS_DAY = new Set(['none', 'previous', 'next']);

/** The JSON types validateItem relies on (it would throw on, say, a numeric name). */
function hasItemShape(v: unknown): v is Record<string, unknown> {
  if (!isObj(v)) return false;
  const sched = v.schedule;
  return (
    isStr(v.id) &&
    v.id.trim() !== '' &&
    isStr(v.name) &&
    isObj(v.kind) &&
    isStr(v.amount) &&
    isStr(v.currency) &&
    isObj(sched) &&
    isStr(sched.start) &&
    (sched.end === null || sched.end === undefined || isStr(sched.end)) &&
    isObj(sched.every) &&
    isStr(v.businessDay) &&
    BUSINESS_DAY.has(v.businessDay) &&
    typeof v.included === 'boolean' &&
    (v.paidFrom === null || v.paidFrom === undefined || isStr(v.paidFrom)) &&
    typeof v.createdAt === 'number' &&
    Number.isFinite(v.createdAt) &&
    typeof v.updatedAt === 'number' &&
    Number.isFinite(v.updatedAt)
  );
}

/**
 * Every item goes through the editor's own validateItem (the same rules as
 * typing it in), keeping its id and timestamps. One bad item or a repeated id
 * rejects the whole backup: a partial restore would lose data silently.
 */
function restoredItems(raw: unknown[]): StoredItem[] {
  const seen = new Set<string>();
  return raw.map((v, n) => {
    if (!hasItemShape(v)) throw damaged(`item ${n}: shape`);
    const r = validateItem(v as Partial<StoredItem>);
    if (!r.ok) throw damaged(`item ${n}: ${Object.keys(r.errors).join(', ')}`);
    const item: StoredItem = {
      ...r.item,
      id: v.id as string,
      createdAt: v.createdAt as number,
      updatedAt: v.updatedAt as number,
    };
    if (seen.has(item.id)) throw damaged(`item ${n}: duplicate id`);
    seen.add(item.id);
    return item;
  });
}

/**
 * The decrypted JSON as BackupData, or DAMAGED. Items must all be valid;
 * settings keep only the fields that are (see `validSettings`), so a bad
 * optional field falls back to its default instead of failing the restore.
 */
function parsePayload(bytes: Uint8Array): BackupData {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw damaged('payload not JSON');
  }
  if (!isObj(raw) || !isObj(raw.settings) || !Array.isArray(raw.items)) throw damaged('payload shape');
  const items = restoredItems(raw.items);
  // Partial: missing or invalid fields are filled in by prepareImport.
  return { settings: validSettings(raw.settings) as AppSettings, items };
}

/**
 * Opens a `.lantaw` file's text with `passphrase` and validates everything
 * inside. Throws BackupImportError: NOT_LANTAW (not ours, broken envelope,
 * out-of-range KDF), NEWER_VERSION, WRONG_PASSPHRASE (also a tampered
 * ciphertext: GCM can't tell the two apart) or DAMAGED (it decrypted, but an
 * item is invalid). Never touches storage.
 */
export async function importBackup(text: string, passphrase: string): Promise<BackupData> {
  const env = parseEnvelope(text);
  let plaintext: Uint8Array;
  try {
    plaintext = decryptBackup(env.ciphertext, passphrase, env.salt, env.nonce, env.kdf.m, env.kdf.t, env.kdf.p);
  } catch (e) {
    if (e instanceof EngineError && e.code === 'BACKUP') throw new BackupImportError('WRONG_PASSPHRASE');
    if (e instanceof EngineError && e.code === 'BAD_INPUT') throw notLantaw(e.detail);
    throw e;
  }
  return parsePayload(plaintext);
}

// ---------------------------------------------------------------- merge / replace

const isMain = (i: StoredItem) => i.kind.type === 'income' && i.kind.mainSweldo;

/**
 * Items matched by `id`; the newer `updatedAt` wins (a tie keeps the local
 * copy). If that leaves several main sweldos, the newest flagged one keeps
 * the flag.
 */
export function mergeItems(local: StoredItem[], incoming: StoredItem[]): StoredItem[] {
  const out = new Map(local.map((i) => [i.id, i]));
  for (const i of incoming) {
    const mine = out.get(i.id);
    if (!mine || i.updatedAt > mine.updatedAt) out.set(i.id, i);
  }
  const merged = [...out.values()];
  const mains = merged.filter(isMain).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  return mains.length > 1 ? setMainSweldo(merged, mains[0].id) : merged;
}

/** A valid amount, kept exactly as written when already canonical ("3000", "2.5"), else normalised. */
function cleanMoney(v: unknown, parse: (raw: string) => ParseResult): string | undefined {
  if (!isStr(v)) return undefined;
  const r = parse(v);
  if (!r.ok) return undefined;
  return /^\d+(\.\d{1,2})?$/.test(v) ? v : r.value;
}

const HOLIDAY_NAME_MAX = 40;

type Clean = (v: unknown) => unknown;
const bool: Clean = (v) => (typeof v === 'boolean' ? v : undefined);

/** Each settings field: its cleaned value, or undefined when it isn't valid (then the default is used). */
const SETTING_CLEANERS: Record<keyof AppSettings, Clean> = {
  balance: (v) => cleanMoney(v, parseAmount),
  balanceAsOf: (v) => (isIsoDate(v) ? v : undefined),
  safetyBuffer: (v) => cleanMoney(v, parseAmount),
  horizonMonths: (v) => (v === 12 || v === 24 ? v : undefined),
  cardFxFeePct: (v) => cleanMoney(v, parseFeePct),
  paidOnAsOf: (v) => (Array.isArray(v) && v.every(isStr) ? [...v] : undefined),
  davaoHolidays: bool,
  customHolidays: (v) => (Array.isArray(v) ? [...new Set(v.filter(isIsoDate))].sort() : undefined),
  // Own properties only, dated keys only (so never "__proto__"), short string names.
  holidayNames: (v) =>
    isObj(v)
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([k, n]) => isIsoDate(k) && isStr(n) && n.trim() !== '')
            .map(([k, n]) => [k, (n as string).trim().slice(0, HOLIDAY_NAME_MAX)]),
        )
      : undefined,
  theme: (v) => (v === 'system' || v === 'dark' || v === 'light' ? v : undefined),
  onboarded: bool,
  isSample: bool,
};

/** The known settings fields of `raw` that are valid (cleaned); the rest are left out. */
function validSettings(raw: object): Partial<AppSettings> {
  const out: Record<string, unknown> = {};
  for (const [key, clean] of Object.entries(SETTING_CLEANERS)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const v = clean((raw as Record<string, unknown>)[key]);
    if (v !== undefined) out[key] = v;
  }
  return out as Partial<AppSettings>;
}

/** Merge: keep every local setting; only fields the local copy lacks come from the backup. */
export function mergeSettings(local: Partial<AppSettings>, incoming: Partial<AppSettings>): AppSettings {
  return { ...validSettings(incoming), ...validSettings(local) } as AppSettings;
}

/**
 * What to store for an import. Replace: the backup's settings (defaults for
 * missing or malformed fields) and items. Merge: local settings filled in from
 * the backup, items via `mergeItems`. Either way exactly one income ends up
 * the main sweldo, the user stays onboarded and the data is no longer the sample.
 */
export function prepareImport(
  mode: 'replace' | 'merge',
  local: BackupData,
  incoming: BackupData,
  today: string,
): BackupData {
  const defaults = DEFAULT_SETTINGS(today);
  const settings: AppSettings =
    mode === 'replace'
      ? { ...defaults, ...validSettings(incoming.settings) }
      : { ...defaults, ...mergeSettings(local.settings, incoming.settings) };
  settings.onboarded = true;
  // Restored or merged data is the user's own now, never the sample.
  settings.isSample = false;
  // Names only for dates still on the list.
  settings.holidayNames = Object.fromEntries(
    Object.entries(settings.holidayNames ?? {}).filter(([d]) => settings.customHolidays.includes(d)),
  );

  let items = mode === 'replace' ? [...incoming.items] : mergeItems(local.items, incoming.items);
  const fixes = new Map(ensureMainSweldo(items).map((i) => [i.id, i]));
  if (fixes.size > 0) items = items.map((i) => fixes.get(i.id) ?? i);
  return toPlain({ settings, items });
}
