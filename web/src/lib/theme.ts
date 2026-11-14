// Theme: 'system' follows prefers-color-scheme (tokens.css does that when
// <html> has no data-theme); 'dark' and 'light' pin it. The browser UI colour
// (<meta name="theme-color">) follows whichever one is showing.
//
// The choice is mirrored to localStorage so main.ts can apply it before the
// first paint, without waiting for IndexedDB. Settings stay the source of truth.

import type { AppSettings } from './db';

export type Theme = AppSettings['theme'];

export const THEME_COLORS = { dark: '#06121A', light: '#BCD3DE' } as const;

const STORE_KEY = 'lantaw-theme';
const LIGHT_QUERY = '(prefers-color-scheme: light)';

export const isTheme = (v: unknown): v is Theme => v === 'system' || v === 'dark' || v === 'light';

/**
 * Which theme App should apply now: none until the stored settings have
 * loaded. Before that `app.settings` holds the default 'system', and applying
 * it would undo the pre-mount theme (a flash) and overwrite the stored hint.
 */
export function themeToApply(storedLoaded: boolean, theme: Theme): Theme | null {
  return storedLoaded ? theme : null;
}

/** The theme actually showing. */
export function resolveTheme(theme: Theme, prefersLight: boolean): 'dark' | 'light' {
  if (theme === 'system') return prefersLight ? 'light' : 'dark';
  return theme;
}

type Doc = Pick<Document, 'documentElement' | 'querySelector'>;

/** Sets `data-theme` (removed for System) and the theme-color meta. */
export function applyTheme(theme: Theme, prefersLight: boolean, doc: Doc = document): void {
  const root = doc.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolveTheme(theme, prefersLight)]);
}

function prefersLight(): boolean {
  return typeof matchMedia === 'function' && matchMedia(LIGHT_QUERY).matches;
}

/**
 * Applies `theme` now and, for System, again whenever the OS switches between
 * light and dark. Returns the cleanup that stops listening.
 */
export function watchTheme(theme: Theme): () => void {
  applyTheme(theme, prefersLight());
  try {
    localStorage.setItem(STORE_KEY, theme);
  } catch {
    // Storage blocked: the theme still applies once settings load.
  }
  if (theme !== 'system' || typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia(LIGHT_QUERY);
  const onChange = () => applyTheme('system', mq.matches);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/** Before the first paint: the last theme this device used. */
export function applyStoredTheme(): void {
  let t: unknown = null;
  try {
    t = localStorage.getItem(STORE_KEY);
  } catch {
    // Storage blocked.
  }
  applyTheme(isTheme(t) ? t : 'system', prefersLight());
}
