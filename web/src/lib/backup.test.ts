import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The real engine, with decryptBackup wrapped in a spy so tests can prove a
// crafted file is rejected before any Argon2 work starts.
vi.mock('./engine', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./engine')>();
  return { ...mod, decryptBackup: vi.fn(mod.decryptBackup) };
});

import { decryptBackup, initEngineSync } from './engine';
import { DEFAULT_SETTINGS, type StoredItem } from './db';
import {
  BackupImportError,
  DEFAULT_KDF,
  IMPORT_MESSAGES,
  KDF_LIMITS,
  backupFilename,
  exportBackup,
  importBackup,
  mergeItems,
  mergeSettings,
  prepareImport,
  type BackupData,
  type BackupFile,
} from './backup';

const FAST = { m: 64, t: 1, p: 1 };

beforeAll(() => {
  initEngineSync(readFileSync('src/lib/wasm-pkg/lantaw_engine_bg.wasm'));
});
beforeEach(() => {
  vi.mocked(decryptBackup).mockClear();
});

const item = (id: string, updatedAt: number, over: Partial<StoredItem> = {}): StoredItem => ({
  id,
  name: id,
  kind: { type: 'bill' },
  amount: '100.00',
  currency: 'PHP',
  schedule: { start: '2026-11-15', end: null, every: { type: 'monthly', day: 15 } },
  businessDay: 'none',
  included: true,
  paidFrom: null,
  createdAt: 1,
  updatedAt,
  ...over,
});
const income = (id: string, updatedAt: number, main: boolean, createdAt = 1): StoredItem =>
  item(id, updatedAt, { kind: { type: 'income', mainSweldo: main }, createdAt });

const data = (): BackupData => ({
  settings: { ...DEFAULT_SETTINGS('2026-11-13'), balance: '8240.00', onboarded: true, customHolidays: ['2026-12-08'] },
  items: [income('sweldo', 10, true), item('davao-light', 20, { name: 'Davao Light — ₱ ñ' })],
});

async function fileText(d = data(), pass = 'correct horse'): Promise<string> {
  const { blob } = await exportBackup(d, pass, FAST);
  return blob.text();
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(BackupImportError);
    return (e as BackupImportError).code;
  }
  throw new Error('expected a BackupImportError');
}

/** A valid file with one part changed. */
async function crafted(edit: (f: BackupFile) => void): Promise<string> {
  const f = JSON.parse(await fileText()) as BackupFile;
  edit(f);
  return JSON.stringify(f);
}

describe('exportBackup / importBackup', () => {
  it('round-trips the same data with the same passphrase', async () => {
    const text = await fileText();
    expect(await importBackup(text, 'correct horse')).toEqual(data());
  });

  it('writes the documented file shape, with no plaintext in it', async () => {
    const { filename, blob } = await exportBackup(data(), 'correct horse', FAST);
    expect(filename).toMatch(/^lantaw-backup-\d{4}-\d{2}-\d{2}\.lantaw$/);
    const f = JSON.parse(await blob.text()) as BackupFile;
    expect(f.format).toBe('lantaw-backup');
    expect(f.version).toBe(1);
    expect(f.kdf).toMatchObject({ alg: 'argon2id', m: 64, t: 1, p: 1 });
    expect(atob(f.kdf.salt)).toHaveLength(16);
    expect(atob(f.nonce)).toHaveLength(12);
    expect(Number.isNaN(Date.parse(f.createdAt))).toBe(false);
    const raw = await blob.text();
    expect(raw).not.toContain('davao-light');
    expect(raw).not.toContain('8240');
  });

  it('uses a fresh salt and nonce every time', async () => {
    const a = JSON.parse(await fileText()) as BackupFile;
    const b = JSON.parse(await fileText()) as BackupFile;
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('never exports $state-style extras: only settings and items', async () => {
    const d = { ...data(), cache: [{ key: 'fx:USD' }] } as unknown as BackupData;
    const out = await importBackup(await fileText(d), 'correct horse');
    expect(Object.keys(out).sort()).toEqual(['items', 'settings']);
  });

  it('a wrong passphrase gives WRONG_PASSPHRASE', async () => {
    expect(await codeOf(importBackup(await fileText(), 'wrong horse'))).toBe('WRONG_PASSPHRASE');
  });

  it('a tampered ciphertext gives WRONG_PASSPHRASE (the tag check fails)', async () => {
    const text = await crafted((f) => {
      const bytes = Uint8Array.from(atob(f.ciphertext), (c) => c.charCodeAt(0));
      bytes[0] ^= 1;
      f.ciphertext = btoa(String.fromCharCode(...bytes));
    });
    expect(await codeOf(importBackup(text, 'correct horse'))).toBe('WRONG_PASSPHRASE');
  });

  it('{"hello":1} gives NOT_LANTAW', async () => {
    expect(await codeOf(importBackup('{"hello":1}', 'x'))).toBe('NOT_LANTAW');
  });

  it('non-JSON and non-object JSON give NOT_LANTAW', async () => {
    for (const t of ['', 'not json', '[]', 'null', '42', '"lantaw-backup"']) {
      expect(await codeOf(importBackup(t, 'x'))).toBe('NOT_LANTAW');
    }
  });

  it('version 2 gives NEWER_VERSION', async () => {
    const text = await crafted((f) => {
      (f as { version: number }).version = 2;
    });
    expect(await codeOf(importBackup(text, 'correct horse'))).toBe('NEWER_VERSION');
    expect(decryptBackup).not.toHaveBeenCalled();
  });

  it('version 0 or a non-integer version gives NOT_LANTAW', async () => {
    for (const v of [0, 1.5, '1', null]) {
      const text = await crafted((f) => {
        (f as { version: unknown }).version = v;
      });
      expect(await codeOf(importBackup(text, 'correct horse'))).toBe('NOT_LANTAW');
    }
  });
});

describe('importBackup KDF clamp: crafted params never reach the engine', () => {
  const cases: [string, (f: BackupFile) => void][] = [
    ['m too large (1 GiB)', (f) => (f.kdf.m = 1_048_576)],
    ['m just over 64 MiB', (f) => (f.kdf.m = 65_537)],
    ['m × t just over the budget (38913 × 4)', (f) => Object.assign(f.kdf, { m: 38_913, t: 4 })],
    ['m × t over the budget (65536 × 3)', (f) => Object.assign(f.kdf, { m: 65_536, t: 3 })],
    ['the old ceiling (256 MiB, t 10, p 4)', (f) => Object.assign(f.kdf, { m: 262_144, t: 10, p: 4 })],
    ['m too small', (f) => (f.kdf.m = 4)],
    ['m below 8 × p', (f) => Object.assign(f.kdf, { m: 16, p: 4 })],
    ['m not an integer', (f) => (f.kdf.m = 64.5)],
    ['t too large', (f) => (f.kdf.t = 5)],
    ['t zero', (f) => (f.kdf.t = 0)],
    ['p too large', (f) => (f.kdf.p = 5)],
    ['t as a string', (f) => ((f.kdf as unknown as { t: string }).t = '1')],
    ['another algorithm', (f) => ((f.kdf as unknown as { alg: string }).alg = 'scrypt')],
    ['salt of 15 bytes', (f) => (f.kdf.salt = btoa('x'.repeat(15)))],
    ['salt of 17 bytes', (f) => (f.kdf.salt = btoa('x'.repeat(17)))],
    ['salt not base64', (f) => (f.kdf.salt = '!!!!not-base64!!!!!!!!!!')],
    ['nonce of 16 bytes', (f) => (f.nonce = btoa('x'.repeat(16)))],
    ['ciphertext not base64', (f) => (f.ciphertext = 'abc$')],
    ['ciphertext empty', (f) => (f.ciphertext = '')],
    ['kdf missing', (f) => delete (f as Partial<BackupFile>).kdf],
  ];
  for (const [name, edit] of cases) {
    it(`${name} gives NOT_LANTAW without decrypting`, async () => {
      const text = await crafted(edit);
      expect(await codeOf(importBackup(text, 'correct horse'))).toBe('NOT_LANTAW');
      expect(decryptBackup).not.toHaveBeenCalled();
    });
  }

  it('accepts the limits themselves (m 8, p 1) and decrypts', async () => {
    const { blob } = await exportBackup(data(), 'pw-pw-pw-pw', { m: 8, t: 1, p: 1 });
    expect(await importBackup(await blob.text(), 'pw-pw-pw-pw')).toEqual(data());
    expect(decryptBackup).toHaveBeenCalledTimes(1);
  });

  it('accepts the ceilings: m 65536 with t 2, and m × t exactly 155648 (38912 × 4, p 4)', async () => {
    for (const kdf of [{ m: 65_536, t: 2, p: 1 }, { m: 38_912, t: 4, p: 4 }]) {
      const { blob } = await exportBackup(data(), 'pw-pw-pw-pw', kdf);
      expect(await importBackup(await blob.text(), 'pw-pw-pw-pw')).toEqual(data());
    }
    expect(decryptBackup).toHaveBeenCalledTimes(2);
  });

  it('KDF_LIMITS match the ruling (work budget is 4× the default)', () => {
    expect(KDF_LIMITS).toEqual({ m: [8, 65_536], t: [1, 4], p: [1, 4], work: 155_648 });
    expect(KDF_LIMITS.work).toBe(4 * DEFAULT_KDF.m * DEFAULT_KDF.t);
  });
});

describe('importBackup: a correctly decrypted but damaged payload', () => {
  const withItems = (items: unknown[]) => ({ ...data(), items }) as unknown as BackupData;
  const good = () => item('ok', 1) as unknown as Record<string, unknown>;

  it('not { settings, items } gives DAMAGED', async () => {
    const bad = { settings: 'nope', items: [] } as unknown as BackupData;
    expect(await codeOf(importBackup(await fileText(bad), 'correct horse'))).toBe('DAMAGED');
    expect(await codeOf(importBackup(await fileText(withItems([{ id: 5 }])), 'correct horse'))).toBe('DAMAGED');
  });

  const broken: [string, () => unknown][] = [
    ['amount "abc"', () => ({ ...good(), amount: 'abc' })],
    ['a negative amount', () => ({ ...good(), amount: '-5' })],
    ['kind.type "whatever"', () => ({ ...good(), kind: { type: 'whatever' } })],
    ['schedule.every {}', () => ({ ...good(), schedule: { start: '2026-11-15', end: null, every: {} } })],
    ['a start that is not a date', () => ({ ...good(), schedule: { start: 'soon', end: null, every: { type: 'once' } } })],
    ['monthly day 40', () => ({ ...good(), schedule: { start: '2026-11-15', end: null, every: { type: 'monthly', day: 40 } } })],
    ['an installment of 0 payments', () => ({ ...good(), kind: { type: 'installment', totalPayments: 0, paidOverride: null } })],
    ['a name that is a number', () => ({ ...good(), name: 42 })],
    ['a blank name', () => ({ ...good(), name: '   ' })],
    ['currency "usd!"', () => ({ ...good(), currency: 'usd!' })],
    ['a business-day rule "sometimes"', () => ({ ...good(), businessDay: 'sometimes' })],
    ['updatedAt missing', () => ({ ...good(), updatedAt: undefined })],
  ];
  for (const [name, make] of broken) {
    it(`an item with ${name} rejects the whole import as DAMAGED`, async () => {
      const text = await fileText(withItems([item('fine', 1), make()]));
      expect(await codeOf(importBackup(text, 'correct horse'))).toBe('DAMAGED');
    });
  }

  it('duplicate item ids give DAMAGED', async () => {
    const text = await fileText(withItems([item('same', 1), item('same', 2)]));
    expect(await codeOf(importBackup(text, 'correct horse'))).toBe('DAMAGED');
  });

  it('valid items keep their id and timestamps; amounts are normalised', async () => {
    const kept = { ...item('kept', 7, { amount: '1,250.5' }), createdAt: 3 };
    const out = await importBackup(await fileText(withItems([kept])), 'correct horse');
    expect(out.items[0]).toMatchObject({ id: 'kept', createdAt: 3, updatedAt: 7, amount: '1250.50' });
  });

  it('the copy for DAMAGED and WRONG_PASSPHRASE', () => {
    expect(IMPORT_MESSAGES.DAMAGED).toBe('This backup is damaged and can’t be restored.');
    expect(IMPORT_MESSAGES.WRONG_PASSPHRASE).toBe('That password doesn’t open this backup, or the file is damaged.');
  });
});

describe('importBackup: wrong settings fields fall back to defaults', () => {
  const replaceWith = (out: BackupData) =>
    prepareImport('replace', { settings: DEFAULT_SETTINGS('2026-11-13'), items: [] }, out, '2026-11-13').settings;

  it('drops bad fields and keeps good ones; Replace fills the defaults', async () => {
    const settings = {
      ...data().settings,
      balance: 'abc',
      safetyBuffer: '-5',
      cardFxFeePct: '12',
      balanceAsOf: '2026-02-30',
      horizonMonths: 36,
      theme: 'blue',
      davaoHolidays: 'yes',
      paidOnAsOf: [1, 2],
      customHolidays: ['2026-12-08', 'nope', '2026-12-08', '2026-11-30'],
      holidayNames: { '2026-12-08': 'Feast', '2027-01-01': 'not listed', '2026-11-30': 7 },
      extra: 'ignored',
    };
    const out = await importBackup(await fileText({ ...data(), settings } as unknown as BackupData), 'correct horse');
    const s = replaceWith(out);
    const d = DEFAULT_SETTINGS('2026-11-13');
    expect(s.balance).toBe(d.balance);
    expect(s.safetyBuffer).toBe(d.safetyBuffer);
    expect(s.cardFxFeePct).toBe(d.cardFxFeePct);
    expect(s.balanceAsOf).toBe('2026-11-13');
    expect(s.horizonMonths).toBe(12);
    expect(s.theme).toBe('system');
    expect(s.davaoHolidays).toBe(true);
    expect(s.paidOnAsOf).toEqual([]);
    expect(s.customHolidays).toEqual(['2026-11-30', '2026-12-08']);
    expect(s.holidayNames).toEqual({ '2026-12-08': 'Feast' });
    expect('extra' in s).toBe(false);
  });

  it('a "__proto__" key in holidayNames never touches a prototype', async () => {
    const settings = JSON.parse(
      JSON.stringify(data().settings).replace(
        '"holidayNames":{}',
        '"holidayNames":{"__proto__":{"polluted":1},"2026-12-08":"Feast"}',
      ),
    );
    const out = await importBackup(await fileText({ ...data(), settings }), 'correct horse');
    const s = replaceWith(out);
    expect(s.holidayNames).toEqual({ '2026-12-08': 'Feast' });
    expect(Object.getPrototypeOf(s.holidayNames)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('good amount strings come back exactly as exported', async () => {
    const settings = { ...data().settings, safetyBuffer: '3000', cardFxFeePct: '2.5', balance: '0.5' };
    const out = await importBackup(await fileText({ ...data(), settings }), 'correct horse');
    expect(out.settings).toMatchObject({ safetyBuffer: '3000', cardFxFeePct: '2.5', balance: '0.5' });
  });
});

describe('backupFilename', () => {
  it('uses the local date', () => {
    expect(backupFilename(new Date(2026, 10, 3, 23, 59))).toBe('lantaw-backup-2026-11-03.lantaw');
    expect(backupFilename(new Date(2027, 0, 1, 0, 1))).toBe('lantaw-backup-2027-01-01.lantaw');
  });
});

describe('mergeItems', () => {
  it('keeps the newer item by updatedAt and adds new ones', () => {
    const local = [item('a', 10, { amount: '1.00' }), item('b', 50, { amount: '2.00' }), item('c', 5)];
    const incoming = [item('a', 20, { amount: '9.00' }), item('b', 40, { amount: '8.00' }), item('d', 1)];
    const out = mergeItems(local, incoming);
    const by = (id: string) => out.find((i) => i.id === id)!;
    expect(out.map((i) => i.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(by('a').amount).toBe('9.00'); // incoming newer
    expect(by('b').amount).toBe('2.00'); // local newer
    expect(by('c')).toEqual(local[2]); // only local
    expect(by('d')).toEqual(incoming[2]); // only incoming
  });

  it('keeps the local item on a tie', () => {
    const out = mergeItems([item('a', 10, { amount: '1.00' })], [item('a', 10, { amount: '9.00' })]);
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe('1.00');
  });

  it('leaves exactly one main sweldo: the newest flagged one', () => {
    const local = [income('job', 10, true)];
    const incoming = [income('freelance', 30, true), income('side', 40, false)];
    const out = mergeItems(local, incoming);
    const mains = out.filter((i) => i.kind.type === 'income' && i.kind.mainSweldo).map((i) => i.id);
    expect(mains).toEqual(['freelance']);
  });
});

describe('mergeSettings and prepareImport', () => {
  it('merge keeps local settings and fills fields the local copy lacks', () => {
    const local = { ...DEFAULT_SETTINGS('2026-11-13'), balance: '100.00', onboarded: true };
    delete (local as Partial<typeof local>).customHolidays;
    const incoming = { ...DEFAULT_SETTINGS('2026-10-01'), balance: '999.00', customHolidays: ['2026-12-08'] };
    const out = mergeSettings(local, incoming);
    expect(out.balance).toBe('100.00');
    expect(out.balanceAsOf).toBe('2026-11-13');
    expect(out.customHolidays).toEqual(['2026-12-08']);
  });

  it('replace takes the backup, fills defaults and stays onboarded', () => {
    const incoming = { ...data().settings, onboarded: false } as Partial<BackupData['settings']>;
    delete incoming.davaoHolidays;
    const out = prepareImport(
      'replace',
      { settings: DEFAULT_SETTINGS('2026-11-13'), items: [item('x', 1)] },
      { settings: incoming as BackupData['settings'], items: data().items },
      '2026-11-13',
    );
    expect(out.settings.balance).toBe('8240.00');
    expect(out.settings.davaoHolidays).toBe(true);
    expect(out.settings.onboarded).toBe(true);
    expect(out.items.map((i) => i.id)).toEqual(['sweldo', 'davao-light']);
  });

  it('replace repairs a backup with no main sweldo (earliest income promoted)', () => {
    const out = prepareImport(
      'replace',
      { settings: DEFAULT_SETTINGS('2026-11-13'), items: [] },
      { settings: data().settings, items: [income('late', 5, false, 9), income('early', 5, false, 2)] },
      '2026-11-13',
    );
    const mains = out.items.filter((i) => i.kind.type === 'income' && i.kind.mainSweldo).map((i) => i.id);
    expect(mains).toEqual(['early']);
  });

  it('merge combines items and keeps local settings', () => {
    const localSettings = { ...DEFAULT_SETTINGS('2026-11-13'), balance: '1.00', onboarded: true };
    const out = prepareImport(
      'merge',
      { settings: localSettings, items: [item('a', 1)] },
      { settings: data().settings, items: [item('b', 1)] },
      '2026-11-13',
    );
    expect(out.settings).toEqual(localSettings);
    expect(out.items.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('any import clears isSample (Replace from a sample backup, Merge into a sample)', () => {
    const sampleSettings = { ...DEFAULT_SETTINGS('2026-11-13'), isSample: true, onboarded: true };
    const replaced = prepareImport(
      'replace',
      { settings: DEFAULT_SETTINGS('2026-11-13'), items: [] },
      { settings: sampleSettings, items: [] },
      '2026-11-13',
    );
    expect(replaced.settings.isSample).toBe(false);
    const merged = prepareImport(
      'merge',
      { settings: sampleSettings, items: [] },
      { settings: data().settings, items: [] },
      '2026-11-13',
    );
    expect(merged.settings.isSample).toBe(false);
  });
});

describe('importBackup size limit', () => {
  it('a file far larger than any backup (21 MiB) gives NOT_LANTAW without decrypting', async () => {
    const huge = await crafted((f) => ((f as unknown as { pad: string }).pad = 'x'.repeat(21 * 1024 * 1024)));
    expect(await codeOf(importBackup(huge, 'correct horse'))).toBe('NOT_LANTAW');
    expect(decryptBackup).not.toHaveBeenCalled();
  });
});
