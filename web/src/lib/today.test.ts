import { afterEach, describe, expect, it, vi } from 'vitest';
import { msUntilNextDay, newToday, watchDay } from './today';

describe('newToday', () => {
  it('is the new date when the device date moved on (or back)', () => {
    expect(newToday('2026-11-13', '2026-11-14')).toBe('2026-11-14');
    expect(newToday('2026-11-13', '2026-11-12')).toBe('2026-11-12');
  });
  it('is null on the same day', () => {
    expect(newToday('2026-11-13', '2026-11-13')).toBeNull();
  });
});

describe('msUntilNextDay', () => {
  it('counts to just after the next local midnight', () => {
    expect(msUntilNextDay(new Date(2026, 10, 13, 23, 59, 0))).toBe(61_000);
    expect(msUntilNextDay(new Date(2026, 10, 13, 0, 0, 0))).toBe(24 * 3600_000 + 1000);
  });
  it('rolls over months and years', () => {
    expect(msUntilNextDay(new Date(2026, 11, 31, 23, 0, 0))).toBe(3600_000 + 1000);
  });
});

describe('watchDay', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function targets() {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    return { win, doc };
  }

  it('checks when the page becomes visible or is shown again, not when hidden', () => {
    vi.useFakeTimers();
    const { win, doc } = targets();
    const check = vi.fn();
    const stop = watchDay(check, win, doc);
    doc.dispatchEvent(new Event('visibilitychange'));
    win.dispatchEvent(new Event('pageshow'));
    expect(check).toHaveBeenCalledTimes(2);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(check).toHaveBeenCalledTimes(2);
    stop();
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    win.dispatchEvent(new Event('pageshow'));
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('checks just after local midnight, every night', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 13, 23, 59, 0));
    const { win, doc } = targets();
    const check = vi.fn();
    const stop = watchDay(check, win, doc);
    vi.advanceTimersByTime(60_000);
    expect(check).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(check).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(24 * 3600_000);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(48 * 3600_000);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
