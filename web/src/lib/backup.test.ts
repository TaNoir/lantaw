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
    ['m too small', (f) => (f.kdf.m = 4)],
    ['m below 8 × p', (f) => Object.assign(f.kdf, { m: 16, p: 4 })],
    ['m not an integer', (f) => (f.kdf.m = 64.5)],
    ['t too large', (f) => (f.kdf.t = 11)],
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

  it('a decrypted payload that is not { settings, items } gives NOT_LANTAW', async () => {
    const bad = { settings: 'nope', items: [] } as unknown as BackupData;
    expect(await codeOf(importBackup(await fileText(bad), 'correct horse'))).toBe('NOT_LANTAW');
    const badItem = { ...data(), items: [{ id: 5 }] } as unknown as BackupData;
    expect(await codeOf(importBackup(await fileText(badItem), 'correct horse'))).toBe('NOT_LANTAW');
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
});

describe('importBackup size limit', () => {
  it('a file far larger than any backup (21 MiB) gives NOT_LANTAW without decrypting', async () => {
    const huge = await crafted((f) => ((f as unknown as { pad: string }).pad = 'x'.repeat(21 * 1024 * 1024)));
    expect(await codeOf(importBackup(huge, 'correct horse'))).toBe('NOT_LANTAW');
    expect(decryptBackup).not.toHaveBeenCalled();
  });
});
