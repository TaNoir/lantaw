<script lang="ts">
  // The time bar under the ridge: play walks the year a day at a time, the track
  // is a plain transport (the months sit on the land itself), and dragging it moves
  // the same selection as the ridge. Keyboard users have the ridge's "Date"
  // slider, so the track itself stays out of the tab order and the a11y tree.
  import type { Projection } from '../lib/engine-types';
  import { addDays, formatShort, yearOf } from '../lib/dates';

  let {
    projection,
    selected = $bindable(0),
    playing,
    ontoggleplay,
    onscrub,
    horizonMonths,
    onhorizon,
  }: {
    projection: Projection;
    selected?: number;
    playing: boolean;
    ontoggleplay: () => void;
    onscrub?: () => void;
    horizonMonths: number;
    onhorizon: (months: 12 | 24) => void;
  } = $props();

  let dragging = $state(false);

  const n = $derived(projection.days.length);
  const pct = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * 100);
  const sel = $derived(Math.min(Math.max(selected, 0), Math.max(0, n - 1)));
  const thisYear = $derived(yearOf(projection.start));
  const handleLabel = $derived(formatShort(addDays(projection.start, sel), thisYear));

  function dayAt(e: PointerEvent): number {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = (e.clientX - r.left) / Math.max(1, r.width);
    return Math.min(Math.max(Math.round(t * (n - 1)), 0), n - 1);
  }
  function onDown(e: PointerEvent) {
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    selected = dayAt(e);
    onscrub?.();
  }
  function onMove(e: PointerEvent) {
    if (!dragging) return;
    selected = dayAt(e);
    onscrub?.();
  }
  function onUp() {
    dragging = false;
  }
</script>

<div class="bar">
  <button
    type="button"
    class="play"
    aria-label={playing ? 'Pause' : 'Play the year'}
    aria-pressed={playing}
    onclick={ontoggleplay}
  >
    {#if playing}
      <svg viewBox="0 0 24 24" aria-hidden="true"><path class="stroke" d="M8.5 5.5v13M15.5 5.5v13" /></svg>
    {:else}
      <svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M8 5.2v13.6l10.8-6.8z" /></svg>
    {/if}
  </button>

  <div
    class="track"
    class:dragging
    aria-hidden="true"
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
    onlostpointercapture={onUp}
  >
    <div class="rail"></div>
    <div class="fill-rail" style="width: {pct(sel)}%"></div>
    <span class="handle" style="left: {pct(sel)}%">{handleLabel}</span>
  </div>

  <div class="seg" role="group" aria-label="Look ahead">
    <button type="button" aria-pressed={horizonMonths === 12} onclick={() => onhorizon(12)}>12 mo</button>
    <button type="button" aria-pressed={horizonMonths === 24} onclick={() => onhorizon(24)}>24 mo</button>
  </div>
</div>


<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 12px 8px 8px;
    border-radius: 99px;
    background: var(--glass-solid);
    border: 1px solid var(--glass-line);
    box-shadow: var(--shadow-float);
  }
  @media (min-width: 1024px) and (prefers-reduced-transparency: no-preference) {
    .bar {
      background: var(--glass);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }
  }

  .play {
    flex: none;
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    border: 0;
    border-radius: 99px;
    background: var(--mango);
    color: var(--on-mango);
    cursor: pointer;
    transition: transform 200ms var(--ease-out);
  }
  .play:hover {
    transform: scale(1.05);
  }
  .play:active {
    transform: scale(0.95);
  }
  .play svg {
    width: 22px;
    height: 22px;
  }
  .play .fill {
    fill: currentColor;
  }
  .play .stroke {
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
  }

  .track {
    position: relative;
    flex: 1;
    min-width: 0;
    height: 46px;
    cursor: pointer;
    touch-action: none;
  }
  .rail,
  .fill-rail {
    position: absolute;
    left: 0;
    top: 21px;
    height: 4px;
    border-radius: 4px;
  }
  .rail {
    right: 0;
    background: color-mix(in srgb, var(--text) 12%, transparent);
  }
  .fill-rail {
    background: linear-gradient(90deg, color-mix(in srgb, var(--mango) 35%, transparent), var(--mango));
  }
  .handle {
    position: absolute;
    top: -20px;
    transform: translateX(-50%);
    padding: 3px 10px;
    border-radius: 99px;
    background: var(--pill-on);
    color: var(--on-pill);
    font-size: 0.75rem;
    font-weight: 800;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 6px 16px -8px rgba(0, 0, 0, 0.5);
  }
  .handle::after {
    content: '';
    position: absolute;
    left: 50%;
    bottom: -4px;
    width: 8px;
    height: 8px;
    border-radius: 1px;
    background: var(--pill-on);
    transform: translateX(-50%) rotate(45deg);
  }

  .seg {
    flex: none;
    display: flex;
    padding: 3px;
    border-radius: 99px;
    background: color-mix(in srgb, var(--text) 7%, transparent);
  }
  .seg button {
    min-height: 36px;
    padding: 0 12px;
    border: 0;
    border-radius: 99px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 700;
    cursor: pointer;
    transition:
      background-color 160ms ease-out,
      color 160ms ease-out;
  }
  .seg button:hover {
    color: var(--text);
  }
  .seg button[aria-pressed='true'] {
    background: color-mix(in srgb, var(--text) 15%, transparent);
    color: var(--text);
  }
  /* Phones: the track gets the whole bar; Look ahead lives in Settings. */
  @media (max-width: 559.98px) {
    .bar {
      gap: 12px;
      padding-right: 20px;
    }
    .seg {
      display: none;
    }
  }
</style>
