const MINUS = '\u2212';
const LIMIT_PESOS = 1_000_000_000_000n;

/** Format integer centavos as pesos: ₱12,480 / ₱12,480.50 / −₱1,240 (U+2212). Integer math only. */
export function formatPeso(centavos: number): string {
  const neg = centavos < 0;
  const abs = BigInt(Math.abs(Math.trunc(centavos)));
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = abs % 100n;
  const frac = cents === 0n ? '' : `.${cents.toString().padStart(2, '0')}`;
  return `${neg ? MINUS : ''}₱${whole}${frac}`;
}

export type ParseResult = { ok: true; value: string } | { ok: false; error: string };

/** Parse user-typed money into a normalized 2-dp decimal string for the engine. */
export function parseAmount(raw: string): ParseResult {
  const s = raw.trim().replace(/,/g, '');
  if (s === '') return { ok: false, error: 'Enter an amount.' };
  if (s.startsWith('-')) return { ok: false, error: 'Amount can’t be negative.' };
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === '' && !m[2])) return { ok: false, error: 'Use numbers only, like 1,250.50.' };
  const whole = m[1] || '0';
  const frac = m[2] ?? '';
  if (frac.length > 2) return { ok: false, error: 'Use at most 2 decimal places.' };
  if (BigInt(whole) >= LIMIT_PESOS) return { ok: false, error: 'That amount is too large.' };
  return { ok: true, value: `${BigInt(whole).toString()}.${frac.padEnd(2, '0')}` };
}

/**
 * Stored decimal string (as saved by `parseAmount`, e.g. "3000.50") to integer
 * centavos, for drawing only (the safety-buffer line). String math, no floats.
 * Anything that is not a plain decimal becomes 0.
 */
export function toCentavos(decimal: string): number {
  const m = /^\s*(-?)(\d+)(?:\.(\d{0,2}))?\s*$/.exec(decimal);
  if (!m) return 0;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] === '-' ? -cents : cents;
}

/** Parse a hand-typed exchange rate (PHP per 1 unit): positive, up to 6 decimals. */
export function parseRate(raw: string): ParseResult {
  const s = raw.trim().replace(/,/g, '');
  if (s === '') return { ok: false, error: 'Enter the rate.' };
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === '' && !m[2])) return { ok: false, error: 'Use numbers only, like 58.25.' };
  if ((m[2] ?? '').length > 6) return { ok: false, error: 'Use at most 6 decimal places.' };
  if (!/[1-9]/.test(s)) return { ok: false, error: 'The rate must be more than zero.' };
  const whole = BigInt(m[1] || '0').toString();
  return { ok: true, value: m[2] ? `${whole}.${m[2]}` : whole };
}

/** Integer centavos as a 2-dp decimal string for the engine or storage: 483167 -> "4831.67". Integer math only. */
export function centavosToDecimal(centavos: number): string {
  const neg = centavos < 0;
  const abs = BigInt(Math.abs(Math.trunc(centavos)));
  return `${neg ? '-' : ''}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, '0')}`;
}
