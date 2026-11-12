import init, * as wasm from './wasm-pkg/lantaw_engine.js';
import type { Comparison, Input, Projection, Purchase } from './engine-types';

export type EngineErrorCode = 'MISSING_FX' | 'INVALID_ITEM' | 'BACKUP' | 'BAD_INPUT' | 'INTERNAL';

export class EngineError extends Error {
  code: EngineErrorCode;
  detail: string;

  constructor(code: EngineErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'EngineError';
    this.code = code;
    this.detail = detail;
  }

  /** Parse a message thrown by the WASM engine (`CODE:detail`). Unknown prefixes become INTERNAL. */
  static parse(raw: unknown): EngineError {
    const msg = raw instanceof Error ? raw.message : String(raw);
    const m = /^(MISSING_FX|INVALID_ITEM|BACKUP|BAD_INPUT):([\s\S]*)$/.exec(msg);
    if (!m) return new EngineError('INTERNAL', msg);
    return new EngineError(m[1] as EngineErrorCode, m[2]);
  }
}

export async function initEngine(): Promise<void> {
  await init();
}

export function initEngineSync(bytes: BufferSource): void {
  wasm.initSync({ module: bytes });
}

function call<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw EngineError.parse(e);
  }
}

export function project(input: Input): Projection {
  return call(() => wasm.project(input) as Projection);
}

export function comparePurchase(input: Input, p: Purchase): Comparison {
  return call(() => wasm.comparePurchase(input, p) as Comparison);
}

export function encryptBackup(
  plaintext: Uint8Array,
  passphrase: string,
  salt: Uint8Array,
  nonce: Uint8Array,
  mKib: number,
  t: number,
  p: number,
): Uint8Array {
  return call(() => wasm.encryptBackup(plaintext, passphrase, salt, nonce, mKib, t, p));
}

export function decryptBackup(
  ciphertext: Uint8Array,
  passphrase: string,
  salt: Uint8Array,
  nonce: Uint8Array,
  mKib: number,
  t: number,
  p: number,
): Uint8Array {
  return call(() => wasm.decryptBackup(ciphertext, passphrase, salt, nonce, mKib, t, p));
}
