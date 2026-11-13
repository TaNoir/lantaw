// Keeping "today" current while the app stays open (a PWA can stay open for
// days): check again when the page is shown, and just after local midnight.

/** The device's new date when it differs from `current`, else null. */
export function newToday(current: string, now: string): string | null {
  return now !== current ? now : null;
}

/** Milliseconds from `now` to one second after the next local midnight. */
export function msUntilNextDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

/**
 * Calls `check` when the page becomes visible, on `pageshow` (back/forward
 * cache) and just after each local midnight. Returns the cleanup function.
 */
export function watchDay(
  check: () => void,
  win: EventTarget = window,
  doc: EventTarget & { visibilityState: DocumentVisibilityState } = document,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      check();
      arm();
    }, msUntilNextDay(new Date()));
  };
  const onVisible = () => {
    if (doc.visibilityState !== 'visible') return;
    check();
    arm(); // timers can be held back while hidden or asleep
  };
  const onShow = () => {
    check();
    arm();
  };
  doc.addEventListener('visibilitychange', onVisible);
  win.addEventListener('pageshow', onShow);
  arm();
  return () => {
    clearTimeout(timer);
    doc.removeEventListener('visibilitychange', onVisible);
    win.removeEventListener('pageshow', onShow);
  };
}
