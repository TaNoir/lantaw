import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

const DAY = 24 * 60 * 60;

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'prompt',
      // components/UpdatePrompt.svelte registers through virtual:pwa-register.
      injectRegister: false,
      // public/ files (favicon, icons) are already matched by globPatterns below.
      includeManifestIcons: false,
      manifest: {
        name: 'Lantaw',
        short_name: 'Lantaw',
        description: 'See your money months ahead.',
        theme_color: '#0E2A3A',
        background_color: '#0B2230',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        // The engine .wasm is ~300 KB today; leave plenty of room.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        // The only two network hosts the app talks to (see lib/apis.ts). The app
        // keeps its own copy in IndexedDB too; this is a second layer for flaky
        // connections.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.frankfurter\.dev\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'lantaw-fx',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 32, maxAgeSeconds: 30 * DAY },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/date\.nager\.at\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'lantaw-holidays',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 16, maxAgeSeconds: 365 * DAY },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
