// Generates src/lib/data/holidays-ph.json from Nager.Date (2026-2028).
// Run from anywhere: node web/scripts/fetch-holidays.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../src/lib/data/holidays-ph.json');
const years = [2026, 2027, 2028];
const result = {};
for (const y of years) {
  const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/PH`);
  if (!res.ok) throw new Error(`Nager ${y}: HTTP ${res.status}`);
  const list = await res.json();
  result[y] = list.map((h) => ({ date: h.date, name: h.name }));
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log('wrote', out, Object.fromEntries(years.map((y) => [y, result[y].length])));
