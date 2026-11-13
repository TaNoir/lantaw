import { describe, expect, it } from 'vitest';
import { THEME_COLORS, applyTheme, resolveTheme } from './theme';

function fakeDoc(initial?: string) {
  const dataset: Record<string, string> = initial ? { theme: initial } : {};
  const meta = { content: '', setAttribute(_n: string, v: string) { this.content = v; } };
  const doc = {
    documentElement: { dataset },
    querySelector: (sel: string) => (sel === 'meta[name="theme-color"]' ? meta : null),
  } as unknown as Pick<Document, 'documentElement' | 'querySelector'>;
  return { doc, dataset, meta };
}

describe('theme', () => {
  it('resolves System from the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('pins dark and light with data-theme and sets the meta colour', () => {
    const { doc, dataset, meta } = fakeDoc();
    applyTheme('light', false, doc);
    expect(dataset.theme).toBe('light');
    expect(meta.content).toBe(THEME_COLORS.light);
    expect(THEME_COLORS.light).toBe('#F6F3EC');
    applyTheme('dark', true, doc);
    expect(dataset.theme).toBe('dark');
    expect(meta.content).toBe('#0B2230');
  });

  it('System removes data-theme and follows the OS for the meta colour', () => {
    const { doc, dataset, meta } = fakeDoc('dark');
    applyTheme('system', true, doc);
    expect('theme' in dataset).toBe(false);
    expect(meta.content).toBe('#F6F3EC');
  });
});
