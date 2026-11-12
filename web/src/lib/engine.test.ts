import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { EngineError, initEngineSync, project } from './engine';
import type { Input } from './engine-types';
import sampleJson from './sample/sample-budget.json';

const sample = sampleJson as unknown as Input;

beforeAll(() => {
  initEngineSync(readFileSync('src/lib/wasm-pkg/lantaw_engine_bg.wasm'));
});

describe('engine bridge', () => {
  it('projects the sample budget', () => {
    const p = project(sample);
    expect(p.days.length).toBe(365);
    expect(typeof p.days[0]).toBe('number');
    expect(p.cutoffs[0].payday).toBe('2026-11-13');
  });

  it('throws EngineError MISSING_FX when a rate is removed', () => {
    const noFx: Input = { ...sample, fx: sample.fx.filter((r) => r.currency !== 'USD') };
    try {
      project(noFx);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      expect((e as EngineError).code).toBe('MISSING_FX');
      expect((e as EngineError).detail).toBe('USD');
    }
  });

  it('maps malformed input to BAD_INPUT', () => {
    try {
      project({} as Input);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(EngineError);
      expect((e as EngineError).code).toBe('BAD_INPUT');
    }
  });
});
