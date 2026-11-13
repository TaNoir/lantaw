// Renders the PWA icons in web/public from docs/brand/lantaw-mark.svg, using
// the Chromium that Playwright already has (see chromium-path.mjs).
// Run from anywhere: node web/scripts/make-icons.mjs
//
//   pwa-192.png, pwa-512.png  the mark as drawn (rounded corners, transparent)
//   maskable-512.png          full-bleed Gulf ink, mark inside the 80% safe zone
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { findChromium } from './chromium-path.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const mark = readFileSync(resolve(here, '../../docs/brand/lantaw-mark.svg'), 'utf8');
const out = (name) => resolve(here, '../public', name);

// The mark's drawing without its rounded background, title or comments.
const inner = mark
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>[\s\S]*$/, '')
  .replace(/<title>[\s\S]*?<\/title>/, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<rect[^>]*\/>/, '')
  .trim();

const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="#0E2A3A"/>
  <g transform="translate(32 32) scale(0.72) translate(-32 -36)">${inner}</g>
</svg>`;

const jobs = [
  { svg: mark, size: 192, file: 'pwa-192.png' },
  { svg: mark, size: 512, file: 'pwa-512.png' },
  { svg: maskable, size: 512, file: 'maskable-512.png' },
];

const browser = await chromium.launch({ executablePath: findChromium() });
try {
  for (const { svg, size, file } of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`,
    );
    await page.locator('svg').screenshot({ path: out(file), omitBackground: true });
    await page.close();
    console.log('wrote', out(file));
  }
} finally {
  await browser.close();
}
