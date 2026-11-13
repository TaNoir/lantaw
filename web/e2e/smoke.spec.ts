import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Runs against the production build (`vite preview`), on a 375×812 phone
// viewport. The two outside hosts are blocked so every run is offline and
// deterministic: holidays come from the bundled list, FX from the sample.
// (playwright.config.ts also resolves them nowhere, as a second layer.)
const API_HOSTS = /^https:\/\/(api\.frankfurter\.dev|date\.nager\.at)\//;
const PASS = 'test-pass-123';
const SW_FILE = fileURLToPath(new URL('../dist/sw.js', import.meta.url));

/** Collects API requests that got a response (the list must stay empty). */
function watchApis(context: BrowserContext): string[] {
  const leaked: string[] = [];
  context.on('requestfinished', (req) => {
    if (API_HOSTS.test(req.url())) leaked.push(req.url());
  });
  return leaked;
}

/** Aborts every request to the API hosts, from the page and from the service worker. */
async function blockApis(context: BrowserContext): Promise<void> {
  await context.route(API_HOSTS, (route) => route.abort('internetdisconnected'));
}

/** The state of the active service worker once one is registered. */
const swState = (page: Page) => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state);

const gipitChip = (page: Page) => page.getByText(/Gipit day ·/);

let leaked: string[];

test.beforeEach(({ context }) => {
  leaked = watchApis(context);
});

test.afterEach(() => {
  expect(leaked, 'no request to the API hosts may succeed').toEqual([]);
});

test.describe('smoke', () => {
  test.beforeEach(async ({ context }) => {
    await blockApis(context);
  });

  test('first run, sample, scrub, Kaya ba?, export, erase, restore', async ({ page }, testInfo) => {
    // 1. The intro.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'See your money months ahead.' })).toBeVisible();

    // 2. Try a sample budget -> Timeline with the Gipit day chip.
    await page.getByRole('button', { name: 'Try a sample budget' }).click();
    await expect(gipitChip(page)).toBeVisible();
    await expect(page).toHaveURL(/#\/timeline$/);

    // 3. ArrowRight ×30 on the slider moves the readout.
    const balance = page.getByTestId('balance');
    const slider = page.getByRole('slider', { name: 'Date' });
    const before = (await balance.textContent())?.trim();
    const valueBefore = await slider.getAttribute('aria-valuetext');
    expect(before).toMatch(/₱/);
    await slider.focus();
    for (let n = 0; n < 30; n++) await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveValue('30');
    await expect(slider).not.toHaveAttribute('aria-valuetext', valueBefore ?? '');
    await expect(balance).not.toHaveText(before ?? '');

    // 4. Kaya ba? with a price of 28990 shows at least one verdict tag.
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Kaya ba?' }).click();
    await page.getByLabel('Cash price').fill('28990');
    await expect(page.getByTestId('verdict-tag').first()).toBeVisible();
    await expect(page.getByTestId('verdict-tag').first()).toHaveText(/Kaya|Gipit|Hindi kaya/);

    // 5. Settings -> Export downloads a .lantaw file.
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Export encrypted backup' }).click();
    const exportForm = page.locator('#st-ed-export');
    await exportForm.getByLabel('Password', { exact: true }).fill(PASS);
    await exportForm.getByLabel('Type it again').fill(PASS);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exportForm.getByRole('button', { name: 'Export backup' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^lantaw-backup-\d{4}-\d{2}-\d{2}\.lantaw$/);
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);
    const backup = JSON.parse(readFileSync(file, 'utf8'));
    expect(backup.format).toBe('lantaw-backup');
    expect(backup.kdf.alg).toBe('argon2id');
    expect(typeof backup.ciphertext).toBe('string');

    // 6. Erase everything -> first run again.
    await page.getByRole('button', { name: 'Erase everything' }).click();
    const eraseForm = page.locator('#st-ed-erase');
    await eraseForm.getByLabel(/to confirm/).fill('BURAHON');
    await eraseForm.getByRole('button', { name: 'Erase everything' }).click();
    await expect(page.getByRole('heading', { name: 'See your money months ahead.' })).toBeVisible();

    // ...then import the file (first run offers Replace only) -> the sample items are back.
    await page.getByRole('button', { name: 'Restore from a backup' }).click();
    await page.getByLabel('Backup file').setInputFiles(file);
    await page.getByLabel('Backup password').fill(PASS);
    await page.getByRole('button', { name: 'Open backup' }).click();
    await expect(page.getByRole('heading', { name: /^Backup opened: \d+ items$/ })).toBeVisible();
    await page.getByRole('button', { name: 'Restore this backup' }).click();
    await expect(gipitChip(page)).toBeVisible();

    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('link', { name: 'Items' }).click();
    for (const name of ['Sweldo', 'Rent', 'Netflix', 'Paluwagan', 'BPI 0% laptop']) {
      await expect(page.getByRole('button', { name: `Edit ${name}` })).toBeVisible();
    }

    // Settings -> Import offers Merge / Replace once there is data; Replace keeps the same items.
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Import backup' }).click();
    const importForm = page.locator('#st-ed-import');
    await importForm.getByLabel('Backup file').setInputFiles(file);
    await importForm.getByLabel('Backup password').fill(PASS);
    await importForm.getByRole('button', { name: 'Open backup' }).click();
    await expect(importForm.getByRole('button', { name: 'Merge' })).toBeVisible();
    await importForm.getByRole('button', { name: 'Replace everything' }).click();
    await expect(page.locator('#st-ed-import')).toHaveCount(0);
    await nav.getByRole('link', { name: 'Items' }).click();
    await expect(page.getByRole('button', { name: 'Edit Netflix' })).toBeVisible();
  });

  test('PWA: manifest, service worker, works offline after a reload', async ({ page, context, request }) => {
    // The manifest is linked and served with the right fields.
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    const manifest = await res.json();
    expect(manifest).toMatchObject({
      name: 'Lantaw',
      short_name: 'Lantaw',
      description: 'See your money months ahead.',
      theme_color: '#0E2A3A',
      background_color: '#0B2230',
      display: 'standalone',
    });
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: 'pwa-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: 'pwa-512.png', sizes: '512x512' }),
        expect.objectContaining({ src: 'maskable-512.png', sizes: '512x512', purpose: 'maskable' }),
      ]),
    );
    for (const icon of manifest.icons) {
      const r = await request.get(`/${icon.src}`);
      expect(r.ok(), icon.src).toBe(true);
      expect(r.headers()['content-type']).toContain('image/png');
    }

    await page.goto('/');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    // theme.ts still drives the theme-color meta.
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);

    // The service worker installs (precaching the shell and the .wasm) and activates.
    await expect.poll(() => swState(page)).toBe('activated');
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
      }
      return urls;
    });
    expect(cached.some((u) => /\.wasm(\?|$)/.test(u))).toBe(true);
    expect(cached.some((u) => /\.woff2(\?|$)/.test(u))).toBe(true);

    await page.getByRole('button', { name: 'Try a sample budget' }).click();
    await expect(gipitChip(page)).toBeVisible();

    // Reload with the API hosts still blocked: the worker controls the page and
    // the forecast renders from bundled holidays and the cached FX rate.
    await page.reload();
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await expect(gipitChip(page)).toBeVisible();

    // Fully offline: the shell, the engine and the fonts all come from the cache.
    await context.setOffline(true);
    await page.reload();
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await expect(gipitChip(page)).toBeVisible();
    await expect(page.getByTestId('balance')).toHaveText(/₱/);
    await context.setOffline(false);
  });
});

// No context.route() here: with Playwright's request interception on, Chromium
// leaves the new worker stuck in "activating" after skipWaiting, which never
// happens in a real browser. The API hosts are still unreachable through the
// --host-resolver-rules flag in playwright.config.ts, and checked by afterEach.
test('a new version shows "New version available · Reload"', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => swState(page)).toBe('activated');
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page.getByTestId('update-toast')).toHaveCount(0);

  // A new deploy: sw.js changes. Playwright can't intercept the browser's
  // update check, so change one revision hash in the built file (same
  // length, as `vite preview` caches file sizes) and put it back afterwards.
  const original = readFileSync(SW_FILE, 'utf8');
  const next = original.replace(/revision:"([0-9a-f])/, (_m, c: string) => `revision:"${c === '0' ? '1' : '0'}`);
  expect(next).not.toBe(original);
  expect(next.length).toBe(original.length);
  writeFileSync(SW_FILE, next);
  try {
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());

    const toast = page.getByTestId('update-toast');
    await expect(toast).toBeVisible();
    await expect(page.getByRole('status').filter({ has: toast })).toContainText('New version available');
    const reload = toast.getByRole('button', { name: 'Reload' });

    // Keyboard: Tab reaches the Reload button and Enter works; the waiting
    // worker takes over and the page reloads.
    let tabs = 0;
    while (!(await reload.evaluate((el) => el === document.activeElement)) && tabs < 40) {
      await page.keyboard.press('Tab');
      tabs++;
    }
    await expect(reload).toBeFocused();
    await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
    await expect(page.getByRole('heading', { name: 'See your money months ahead.' })).toBeVisible();
    await expect(page.getByTestId('update-toast')).toHaveCount(0);
    expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(false);
  } finally {
    writeFileSync(SW_FILE, original);
  }
});
