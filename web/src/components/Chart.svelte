<script lang="ts" module>
  // The reveal animation plays once per session, not on every visit to the tab.
  let revealed = false;
</script>

<script lang="ts">
  import type { Projection } from '../lib/engine-types';
  import { areaPath, downsample, nextCutoffIndex } from '../lib/chart';
  import { addDays, daysBetween, formatDate, formatMonthTick, nextMonthStart, yearOf } from '../lib/dates';
  import { formatPeso } from '../lib/money';

  let {
    projection,
    bufferCentavos,
    todayIndex,
    selected = $bindable(0),
  }: {
    projection: Projection;
    bufferCentavos: number;
    todayIndex: number;
    selected?: number;
  } = $props();

  const uid = $props.id();
  const reveal = !revealed;
  revealed = true;

  // Plot insets (px). The range input is laid over the plot with the same
  // insets, so the native thumb position and the drawn scrubber line agree.
  const PAD_X = 10;
  const PAD_TOP = 14;
  const PAD_BOTTOM = 8;
  const THUMB = 2;
  const MAX_POINTS = 400;

  let w = $state(0);
  let h = $state(0);
  let dragging = $state(false);

  const n = $derived(projection.days.length);
  const plotW = $derived(Math.max(0, w - 2 * PAD_X));
  const plotH = $derived(Math.max(0, h - PAD_TOP - PAD_BOTTOM));

  // ---- everything below depends on the projection and size, never on `selected` ----

  const range = $derived.by(() => {
    let lo = Math.min(0, bufferCentavos);
    let hi = bufferCentavos;
    for (const v of projection.days) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    for (const v of projection.whatIfDays ?? []) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi === lo) hi = lo + 100_000;
    const span = hi - lo;
    return { lo: lo < 0 ? lo - span * 0.05 : lo, hi: hi + span * 0.1 };
  });

  const xOf = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yOf = (v: number) => plotH - ((v - range.lo) / (range.hi - range.lo)) * plotH;

  const main = $derived(areaPath(downsample(projection.days, MAX_POINTS), plotW, plotH, range.lo, range.hi));
  const whatIf = $derived(
    projection.whatIfDays
      ? areaPath(downsample(projection.whatIfDays, MAX_POINTS), plotW, plotH, range.lo, range.hi).line
      : '',
  );
  const bufY = $derived(Math.min(plotH, Math.max(0, yOf(bufferCentavos))));
  const zeroY = $derived(Math.min(plotH, Math.max(0, yOf(0))));
  const gipitIdx = $derived(projection.gipit ? daysBetween(projection.start, projection.gipit.date) : -1);

  const ticks = $derived.by(() => {
    const out: { x: number; label: string }[] = [];
    if (plotW <= 0 || n < 2) return out;
    const pxPerMonth = plotW / (n / 30.44);
    const step = [1, 2, 3, 4, 6, 12].find((s) => s * pxPerMonth >= 76) ?? 12;
    let prevYear = -1;
    for (let d = nextMonthStart(projection.start); ; d = nextMonthStart(d)) {
      const idx = daysBetween(projection.start, d);
      if (idx > n - 1) break;
      const month = Number(d.slice(5, 7));
      if ((month - 1) % step !== 0) continue;
      const x = PAD_X + xOf(idx);
      if (x < 22 || x > w - 22) continue;
      const y = yearOf(d);
      out.push({ x, label: formatMonthTick(d, y !== prevYear) });
      prevYear = y;
    }
    return out;
  });

  // ---- the scrubber: cheap reads of the precomputed series ----

  const sel = $derived(Math.min(Math.max(selected, 0), Math.max(0, n - 1)));
  const selX = $derived(xOf(sel));
  const selY = $derived(yOf(projection.days[sel] ?? 0));
  const valueText = $derived(
    `Balance on ${formatDate(addDays(projection.start, sel))}: ${formatPeso(projection.days[sel] ?? 0)}`,
  );

  const clampDay = (i: number) => Math.min(Math.max(i, 0), Math.max(0, n - 1));

  function dayFromPointer(e: PointerEvent): number {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = (e.clientX - r.left - THUMB / 2) / Math.max(1, r.width - THUMB);
    return clampDay(Math.round(t * (n - 1)));
  }

  // Mouse and pen select at once. Touch waits to see a horizontal drag (or a
  // tap) so a vertical swipe over the chart still scrolls the page.
  let touchStart: { x: number; y: number } | null = null;

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      touchStart = { x: e.clientX, y: e.clientY };
      return;
    }
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    selected = dayFromPointer(e);
  }

  function onPointerMove(e: PointerEvent) {
    if (touchStart && !dragging) {
      const dx = Math.abs(e.clientX - touchStart.x);
      const dy = Math.abs(e.clientY - touchStart.y);
      if (dx > 6 && dx > dy) {
        dragging = true;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }
    }
    if (dragging) selected = dayFromPointer(e);
  }

  function onPointerUp(e: PointerEvent) {
    if (touchStart && !dragging) selected = dayFromPointer(e); // a tap
    dragging = false;
    touchStart = null;
  }

  function onPointerCancel() {
    dragging = false;
    touchStart = null;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      selected = clampDay(nextCutoffIndex(sel, projection.cutoffs, projection.start, e.key === 'PageUp' ? 1 : -1));
    }
  }
</script>

<div class="chart">
  <div class="plot" class:dragging bind:clientWidth={w} bind:clientHeight={h}>
    {#if w > 0 && h > 0 && n > 0}
      <svg class="art" class:reveal width={w} height={h} aria-hidden="true">
        <defs>
          <linearGradient id="{uid}-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" class="fill-top" />
            <stop offset="1" class="fill-bottom" />
          </linearGradient>
          <clipPath id="{uid}-above">
            <rect x={-PAD_X} y={-PAD_TOP} width={w} height={bufY + PAD_TOP} />
          </clipPath>
          <clipPath id="{uid}-below">
            <rect x={-PAD_X} y={bufY} width={w} height={h} />
          </clipPath>
          <clipPath id="{uid}-positive">
            <rect x={-PAD_X} y={-PAD_TOP} width={w} height={zeroY + PAD_TOP} />
          </clipPath>
        </defs>

        <g transform="translate({PAD_X} {PAD_TOP})">
          <!-- Below the safety buffer: a faint coral zone. -->
          <rect class="danger" x="0" y={bufY} width={plotW} height={Math.max(0, plotH - bufY)} />
          <path class="area" d={main.area} fill="url(#{uid}-fill)" clip-path="url(#{uid}-positive)" />

          {#if range.lo < 0}
            <line class="zero" x1="0" x2={plotW} y1={zeroY} y2={zeroY} />
          {/if}
          <line class="buffer" x1="0" x2={plotW} y1={bufY} y2={bufY} />

          {#each ticks as t (t.x)}
            <line class="tick" x1={t.x - PAD_X} x2={t.x - PAD_X} y1={plotH - 5} y2={plotH + PAD_BOTTOM} />
          {/each}

          {#if todayIndex > 0 && todayIndex < n}
            <line class="today" x1={xOf(todayIndex)} x2={xOf(todayIndex)} y1="0" y2={plotH} />
          {/if}

          {#if whatIf}
            <path class="whatif" d={whatIf} />
          {/if}
          <path class="line" d={main.line} clip-path="url(#{uid}-above)" />
          <path class="line low" d={main.line} clip-path="url(#{uid}-below)" />

          {#if bufY > 22}
            <text class="buffer-label" x={plotW} y={bufY - 7} text-anchor="end">
              Safety buffer {formatPeso(bufferCentavos)}
            </text>
          {/if}

          {#if gipitIdx >= 0 && projection.gipit}
            <circle class="gipit" cx={xOf(gipitIdx)} cy={yOf(projection.gipit.centavos)} r="5" />
          {/if}

          <line class="scrub-line" x1={selX} x2={selX} y1="0" y2={plotH} />
          <g transform="translate({selX} {selY})">
            <circle class="halo" r="14" />
            <circle class="knob" r="6.5" />
          </g>
        </g>
      </svg>
    {/if}

    {#if n > 0}
      <input
        class="scrub"
        type="range"
        min="0"
        max={Math.max(0, n - 1)}
        step="1"
        value={sel}
        aria-label="Date"
        aria-valuetext={valueText}
        style="--pad-x: {PAD_X}px; --thumb: {THUMB}px"
        oninput={(e) => (selected = clampDay(Number(e.currentTarget.value)))}
        onkeydown={onKey}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerCancel}
        onlostpointercapture={onPointerCancel}
      />
    {/if}
  </div>

  <div class="ticks" aria-hidden="true">
    {#each ticks as t (t.x)}
      <span style="left: {t.x}px">{t.label}</span>
    {/each}
  </div>

  {#if projection.whatIfDays}
    <p class="legend">
      <span class="key"><i class="swatch solid"></i>Your plan</span>
      <span class="key"><i class="swatch dashed"></i>With what-if items</span>
    </p>
  {/if}
</div>

<style>
  .chart {
    position: relative;
    min-width: 0;
  }
  .plot {
    position: relative;
    height: clamp(200px, 32vh, 260px);
    border-radius: 10px;
  }
  @media (min-width: 1024px) {
    .plot {
      height: clamp(280px, 46vh, 440px);
    }
  }
  .plot:has(.scrub:focus-visible) {
    outline: 2px solid var(--teal);
    outline-offset: 4px;
  }

  .art {
    position: absolute;
    inset: 0;
    display: block;
    overflow: visible;
  }
  .art.reveal {
    animation: reveal 900ms cubic-bezier(0.22, 0.8, 0.25, 1) backwards;
  }
  @keyframes reveal {
    from {
      clip-path: inset(0 100% 0 0);
    }
    to {
      clip-path: inset(0 0 0 0);
    }
  }

  .fill-top {
    stop-color: var(--teal);
    stop-opacity: 0.32;
  }
  .fill-bottom {
    stop-color: var(--teal);
    stop-opacity: 0.03;
  }
  .danger {
    fill: var(--coral);
    fill-opacity: 0.07;
  }
  .zero {
    stroke: var(--muted);
    stroke-width: 1;
  }
  .buffer {
    stroke: var(--coral);
    stroke-width: 1.25;
    stroke-dasharray: 4 5;
  }
  .buffer-label {
    font-size: 14px;
    font-weight: 600;
    fill: var(--coral-text);
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 5px;
    stroke-linejoin: round;
  }
  .tick {
    stroke: var(--border);
    stroke-width: 1;
  }
  .today {
    stroke: var(--muted);
    stroke-width: 1;
    stroke-dasharray: 2 4;
  }
  .line {
    fill: none;
    stroke: var(--teal);
    stroke-width: 2.25;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .line.low {
    stroke: var(--coral);
  }
  .whatif {
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.75;
    stroke-dasharray: 6 5;
    stroke-linejoin: round;
  }
  .gipit {
    fill: var(--coral);
    stroke: var(--bg);
    stroke-width: 2.5;
  }
  .scrub-line {
    stroke: var(--mango);
    stroke-width: 1.75;
  }
  .knob {
    fill: var(--mango);
    stroke: var(--bg);
    stroke-width: 2.5;
    transform-box: fill-box;
    transform-origin: center;
    transition: transform 140ms ease-out;
  }
  .halo {
    fill: var(--mango);
    fill-opacity: 0;
    transition: fill-opacity 160ms ease-out;
  }
  .plot.dragging .halo,
  .plot:has(.scrub:focus-visible) .halo {
    fill-opacity: 0.22;
  }
  .plot.dragging .knob {
    transform: scale(1.15);
  }

  /* The real control: a transparent range input over the plot. Its thumb is
     2px wide and its box is inset by the plot padding, so value → x matches
     the drawn scrubber. */
  .scrub {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--pad-x) - var(--thumb) / 2);
    width: calc(100% - 2 * var(--pad-x) + var(--thumb));
    height: 100%;
    margin: 0;
    padding: 0;
    background: transparent;
    appearance: none;
    -webkit-appearance: none;
    cursor: ew-resize;
    touch-action: pan-y;
    -webkit-tap-highlight-color: transparent;
  }
  .scrub:focus {
    outline: none;
  }
  .scrub::-webkit-slider-runnable-track {
    height: 100%;
    background: transparent;
    border: 0;
  }
  .scrub::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: var(--thumb);
    height: 100%;
    background: transparent;
    border: 0;
  }
  .scrub::-moz-range-track {
    height: 100%;
    background: transparent;
    border: 0;
  }
  .scrub::-moz-range-progress {
    background: transparent;
  }
  .scrub::-moz-range-thumb {
    width: var(--thumb);
    height: 100%;
    background: transparent;
    border: 0;
    border-radius: 0;
  }

  .ticks {
    position: relative;
    height: 26px;
    margin-top: 4px;
  }
  .ticks span {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--muted);
    white-space: nowrap;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    margin: 6px 0 0;
    font-size: 0.875rem;
    color: var(--muted);
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .swatch {
    display: inline-block;
    width: 22px;
    height: 0;
    border-top: 2.5px solid var(--teal);
  }
  .swatch.dashed {
    border-top: 2px dashed var(--muted);
  }
</style>
