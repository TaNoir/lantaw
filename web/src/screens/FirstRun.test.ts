import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import FirstRun from './FirstRun.svelte';
import AlreadyInBalance from '../components/AlreadyInBalance.svelte';
import type { EngineEvent } from '../lib/engine-types';

// Server-rendered smoke tests: the markup builds and shows the right things.
// The step-by-step flow is checked by hand in the browser.
describe('FirstRun', () => {
  it('opens on the intro with both ways in', () => {
    const { body } = render(FirstRun);
    expect(body).toContain('See your money months ahead.');
    expect(body).toContain('Nothing leaves your device');
    expect(body).toContain('No sign-up, no bank linking');
    expect(body).toContain('Works offline');
    expect(body).toContain('>Start<');
    expect(body).toContain('Try a sample budget');
  });
});

describe('AlreadyInBalance', () => {
  const ev = (over: Partial<EngineEvent>): EngineEvent => ({
    date: '2026-11-13',
    nominalDate: '2026-11-13',
    itemId: 'x',
    name: 'X',
    centavos: -100,
    note: null,
    included: true,
    ...over,
  });

  it('has one checkbox per item, ticked only for items in paidOnAsOf', () => {
    const { body } = render(AlreadyInBalance, {
      props: {
        events: [
          ev({ itemId: 'sweldo', name: 'Sweldo', centavos: 1_800_000, note: 'moved from Sun Nov 15' }),
          ev({ itemId: 'globe', name: 'Globe postpaid', centavos: -99_900 }),
          ev({ itemId: 'laptop', name: 'Laptop', included: false }),
        ],
        paid: ['globe'],
        onchange: () => {},
      },
    });
    expect(body.match(/type="checkbox"/g)).toHaveLength(2);
    expect(body.match(/checked/g)).toHaveLength(1);
    expect(body).toMatch(/id="[^"]*-globe" checked/);
    expect(body).toContain('+₱18,000');
    expect(body).toContain('−₱999');
    expect(body).toContain('moved from Sun Nov 15');
    expect(body).not.toContain('Laptop');
  });
});
