// Finds a Chromium for Playwright without downloading one.
//
// Order: $PLAYWRIGHT_CHROMIUM_PATH, then the browser this Playwright version
// expects (if it is installed), then the newest Chromium already in the
// ms-playwright cache. Returns undefined to let Playwright use its default.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

function cacheDir() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  return join(homedir(), '.cache', 'ms-playwright');
}

// Executable paths inside each kind of browser folder, per platform.
const EXES = {
  'chromium_headless_shell-': [
    'chrome-headless-shell-win64/chrome-headless-shell.exe',
    'chrome-headless-shell-linux64/chrome-headless-shell',
    'chrome-headless-shell-mac-arm64/chrome-headless-shell',
    'chrome-headless-shell-mac-x64/chrome-headless-shell',
  ],
  'chromium-': [
    'chrome-win64/chrome.exe',
    'chrome-win/chrome.exe',
    'chrome-linux64/chrome',
    'chrome-linux/chrome',
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  ],
};

/** @returns {string | undefined} */
export function findChromium() {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (fromEnv) return fromEnv;

  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    // Unknown platform for this Playwright build: look in the cache below.
  }

  const dir = cacheDir();
  if (!existsSync(dir)) return undefined;
  const entries = readdirSync(dir);
  for (const [prefix, exes] of Object.entries(EXES)) {
    const folders = entries
      .filter((e) => e.startsWith(prefix) && /^\d+$/.test(e.slice(prefix.length)))
      .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)));
    for (const folder of folders) {
      for (const exe of exes) {
        const p = join(dir, folder, exe);
        if (existsSync(p)) return p;
      }
    }
  }
  return undefined;
}
