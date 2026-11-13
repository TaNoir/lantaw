import { defineConfig, devices } from '@playwright/test';
import { findChromium } from './scripts/chromium-path.mjs';

// End-to-end smoke test against the production build (`vite preview`).
// Build first: `npm run build` (needs wasm-pack), then `npx playwright test`.
// Set PLAYWRIGHT_CHROMIUM_PATH to use a specific Chromium; otherwise the one
// Playwright expects, or the newest one already in the ms-playwright cache.
const PORT = Number(process.env.E2E_PORT ?? 4319);
const executablePath = findChromium();

// The app's only outside hosts. Tests also abort them with context.route();
// resolving them nowhere at the browser level keeps every run offline even
// where a test can't use routing (see the update-prompt test).
const NO_APIS = '--host-resolver-rules=MAP api.frankfurter.dev ~NOTFOUND, MAP date.nager.at ~NOTFOUND';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 375, height: 812 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        launchOptions: { ...(executablePath ? { executablePath } : {}), args: [NO_APIS] },
      },
    },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
