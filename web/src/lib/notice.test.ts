import { describe, expect, it } from 'vitest';
import { EngineError } from './engine';
import { forecastNotice, rateNoticeText } from './notice';

describe('forecastNotice', () => {
  it('is null when the forecast is fine', () => {
    expect(forecastNotice(null, [], null)).toBeNull();
  });

  it('a missing rate, marked as still being fetched while its first lookup runs', () => {
    expect(forecastNotice('USD', ['USD'], null)).toEqual({ kind: 'rate', currency: 'USD', fetching: true });
    expect(forecastNotice('USD', ['EUR'], null)).toEqual({ kind: 'rate', currency: 'USD', fetching: false });
  });

  it('an engine error', () => {
    expect(forecastNotice(null, [], new EngineError('INVALID_ITEM', 'rent: bad day'))).toEqual({
      kind: 'error',
      detail: 'rent: bad day',
    });
  });

  it('the missing rate comes first: typing it in is what the user can do now', () => {
    expect(forecastNotice('USD', [], new EngineError('INTERNAL', 'x'))).toMatchObject({ kind: 'rate' });
  });
});

describe('rateNoticeText', () => {
  it('while the lookup runs, says so instead of claiming it failed', () => {
    expect(rateNoticeText('USD', true)).toBe('Getting the latest USD rate…');
  });

  it('after the lookup failed, asks for the rate', () => {
    expect(rateNoticeText('USD', false)).toBe(
      'There’s no saved USD to peso rate yet, and Lantaw couldn’t get one online. Type today’s rate to update your forecast.',
    );
  });
});
