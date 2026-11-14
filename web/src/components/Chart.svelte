<script lang="ts" module>
  // The reveal animation plays once per session, not on every visit to the tab.
  let revealed = false;
</script>

<script lang="ts">
  // The forecast drawn as the nearest ridge: the balance line is the ridge's rim,
  // and the land below it runs to the bottom of the box. The real control is a
  // transparent range input ("Date") laid over the whole box, so keyboard and
  // screen-reader users get a native slider while pointers can drag anywhere.
  import type { Projection } from '../lib/engine-types';
  import { areaPath, downsample, nextCutoffIndex } from '../lib/chart';
  import { addDays, daysBetween, formatDate, formatMonthTick, nextMonthStart, yearOf } from '../lib/dates';
  import { formatPeso } from '../lib/money';

  let {
    projection,
    bufferCentavos,
    todayIndex,
    selected = $bindable(0),
    padBottom = 16,
    padTop = 24,
    padRight = 0,
    onscrub,
  }: {
    projection: Projection;
    bufferCentavos: number;
    todayIndex: number;
    selected?: number;
    /** Space under the lowest point, e.g. for a time bar drawn over the land. */
    padBottom?: number;
    padTop?: number;
    /** Width on the right that something floats over (the cutoff panel): the forecast ends before it, the land runs on. */
    padRight?: number;
    /** Called when a person moves the selection (not when it is set from outside). */
    onscrub?: () => void;
  } = $props();

  const uid = $props.id();
  const reveal = !revealed;
  revealed = true;

  const PAD_X = 14;
  const THUMB = 2;
  const MAX_POINTS = 400;

  let w = $state(0);
  let h = $state(0);
  let dragging = $state(false);

  const n = $derived(projection.days.length);
  const plotW = $derived(Math.max(0, w - 2 * PAD_X - padRight));
  const rightEdge = $derived(plotW + PAD_X + padRight); // right edge of the box, in plot coordinates
  const plotH = $derived(Math.max(0, h - padTop - padBottom));
  const landBottom = $derived(h - padTop); // bottom edge, in plot coordinates

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
    return { lo: lo < 0 ? lo - span * 0.05 : lo, hi: hi + span * 0.04 };
  });

  const xOf = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const yOf = (v: number) => plotH - ((v - range.lo) / (range.hi - range.lo)) * plotH;

  // The rim runs edge to edge: flat stubs carry the first and last day out to the sides.
  const rim = $derived.by(() => {
    if (n === 0 || plotW <= 0) return { line: '', land: '' };
    const { line } = areaPath(downsample(projection.days, MAX_POINTS), plotW, plotH, range.lo, range.hi);
    const y0 = yOf(projection.days[0]).toFixed(2);
    const yN = yOf(projection.days[n - 1]).toFixed(2);
    const full = `M${-PAD_X} ${y0} L${line.slice(1)} L${rightEdge} ${yN}`;
    return { line: full, land: `${full} L${rightEdge} ${landBottom} L${-PAD_X} ${landBottom} Z` };
  });
  const whatIf = $derived(
    projection.whatIfDays && plotW > 0
      ? areaPath(downsample(projection.whatIfDays, MAX_POINTS), plotW, plotH, range.lo, range.hi).line
      : '',
  );
  const bufY = $derived(Math.min(plotH, Math.max(0, yOf(bufferCentavos))));
  const zeroY = $derived(Math.min(plotH, Math.max(0, yOf(0))));
  const gipitIdx = $derived(projection.gipit ? daysBetween(projection.start, projection.gipit.date) : -1);
  const gipit = $derived.by(() => {
    if (gipitIdx < 0 || !projection.gipit) return null;
    const x = xOf(gipitIdx);
    const y = yOf(projection.gipit.centavos);
    const labelX = Math.min(Math.max(x, 76), plotW - 76);
    return {
      x,
      y,
      labelX,
      labelY: Math.min(y + 22, landBottom - 8), // under the lowest point, where the rim never runs
      text: `Gipit day · ${formatPeso(projection.gipit.centavos)}`,
    };
  });

  // Month ticks sit on the land itself, on the same scale as the rim.
  const ticks = $derived.by(() => {
    const out: { x: number; label: string }[] = [];
    if (plotW <= 0 || n < 2) return out;
    const pxPerMonth = plotW / (n / 30.44);
    const step = [1, 2, 3, 4, 6, 12].find((s) => s * pxPerMonth >= 64) ?? 12;
    let prevYear = yearOf(projection.start);
    for (let d = nextMonthStart(projection.start); ; d = nextMonthStart(d)) {
      const idx = daysBetween(projection.start, d);
      if (idx > n - 1) break;
      const y = yearOf(d);
      const newYear = y !== prevYear;
      prevYear = y;
      if ((Number(d.slice(5, 7)) - 1) % step !== 0) continue;
      const x = xOf(idx);
      if (x < 24 || x > plotW - 20) continue;
      out.push({ x, label: formatMonthTick(d, newYear) });
    }
    return out;
  });
  const tickY = $derived(Math.min(plotH + 24, landBottom - 6));
  // Paydays (cutoff starts) are minor ticks on the same axis.
  const paydayTicks = $derived(
    plotW > 0
      ? projection.cutoffs.map((c) => xOf(daysBetween(projection.start, c.payday))).filter((x) => x >= 0 && x <= plotW)
      : [],
  );

  // The safety-buffer label never covers the rim: try the four corners around its line and
  // keep the first whose box the rim does not cross; with none clear, the label is left out.
  const BUF_LABEL_W = 156;
  const bufferLabel = $derived.by(() => {
    if (plotW < BUF_LABEL_W + 8 || n < 2 || bufY <= 18) return null;
    const spans = { right: [plotW - 2 - BUF_LABEL_W, plotW - 2], left: [4, 4 + BUF_LABEL_W] } as const;
    const clear = (side: 'right' | 'left', top: number, bottom: number) => {
      const [x0, x1] = spans[side];
      const i0 = Math.max(0, Math.floor((x0 / plotW) * (n - 1)) - 1);
      const i1 = Math.min(n - 1, Math.ceil((x1 / plotW) * (n - 1)) + 1);
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = i0; i <= i1; i++) {
        const y = yOf(projection.days[i]);
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
      return hi < top - 3 || lo > bottom + 3; // the rim's whole run is above or below the box
    };
    for (const above of [true, false]) {
      for (const side of ['right', 'left'] as const) {
        const top = above ? bufY - 22 : bufY + 4;
        if (above && top < 0) continue;
        if (clear(side, top, top + 18)) {
          return { x: side === 'right' ? plotW - 2 : 4, y: above ? bufY - 8 : bufY + 17, anchor: side === 'right' ? 'end' : 'start' };
        }
      }
    }
    return null;
  });

  // ---- the scrubber: cheap reads of the precomputed series ----

  const sel = $derived(Math.min(Math.max(selected, 0), Math.max(0, n - 1)));
  const selX = $derived(xOf(sel));
  const selY = $derived(yOf(projection.days[sel] ?? 0));
  const valueText = $derived(
    `Balance on ${formatDate(addDays(projection.start, sel))}: ${formatPeso(projection.days[sel] ?? 0)}`,
  );

  const clampDay = (i: number) => Math.min(Math.max(i, 0), Math.max(0, n - 1));

  function choose(i: number) {
    if (i !== selected) {
      selected = i;
    }
    onscrub?.();
  }

  function dayFromPointer(e: PointerEvent): number {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = (e.clientX - r.left - THUMB / 2) / Math.max(1, r.width - THUMB);
    return clampDay(Math.round(t * (n - 1)));
  }

  // Mouse and pen select at once. Touch waits to see a horizontal drag (or a
  // tap) so a vertical swipe over the land still scrolls the page.
  let touchStart: { x: number; y: number } | null = null;

  function onPointerDown(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      touchStart = { x: e.clientX, y: e.clientY };
      return;
    }
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    choose(dayFromPointer(e));
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
    if (dragging) choose(dayFromPointer(e));
  }

  function onPointerUp(e: PointerEvent) {
    if (touchStart && !dragging) choose(dayFromPointer(e)); // a tap
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
      choose(clampDay(nextCutoffIndex(sel, projection.cutoffs, projection.start, e.key === 'PageUp' ? 1 : -1)));
    }
  }
</script>

<div class="ridge" class:dragging bind:clientWidth={w} bind:clientHeight={h}>
  {#if w > 0 && h > 0 && n > 0}
    <svg class="art" class:reveal width={w} height={h} aria-hidden="true">
      <defs>
        <linearGradient id="{uid}-land" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" class="land-top" />
          <stop offset="0.4" class="land-mid" />
          <stop offset="1" class="land-bottom" />
        </linearGradient>
        <linearGradient id="{uid}-rim" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={plotW} y2="0">
          <stop offset="0" class="rim-start" />
          <stop offset="0.55" class="rim-mid" />
          <stop offset="1" class="rim-end" />
        </linearGradient>
        <clipPath id="{uid}-above">
          <rect x={-PAD_X} y={-padTop} width={w} height={bufY + padTop} />
        </clipPath>
        <clipPath id="{uid}-below">
          <rect x={-PAD_X} y={bufY} width={w} height={h} />
        </clipPath>
      </defs>

      <g transform="translate({PAD_X} {padTop})">
        <path class="land" d={rim.land} fill="url(#{uid}-land)" />

        {#if range.lo < 0}
          <line class="zero" x1={-PAD_X} x2={rightEdge} y1={zeroY} y2={zeroY} />
        {/if}
        <line class="buffer" x1={-PAD_X} x2={rightEdge} y1={bufY} y2={bufY} />
        {#each paydayTicks as x, k (k)}
          <line class="tick payday" x1={x} x2={x} y1={tickY - 17} y2={tickY - 14} />
        {/each}
        {#each ticks as t (t.x)}
          <line class="tick" x1={t.x} x2={t.x} y1={tickY - 18} y2={tickY - 13} />
          <text class="tick-label" x={t.x} y={tickY} text-anchor="middle">{t.label}</text>
        {/each}

        {#if todayIndex > 0 && todayIndex < n}
          <line class="today" x1={xOf(todayIndex)} x2={xOf(todayIndex)} y1="0" y2={plotH} />
        {/if}

        {#if whatIf}
          <path class="whatif" d={whatIf} />
        {/if}
        <path class="rim" d={rim.line} stroke="url(#{uid}-rim)" clip-path="url(#{uid}-above)" />
        <path class="rim low" d={rim.line} clip-path="url(#{uid}-below)" />

        {#if gipit}
          <circle class="gipit" cx={gipit.x} cy={gipit.y} r="5" />
        {/if}

        <!-- Labels go last: their halo masks the rim and the what-if dashes behind them. -->
        {#if bufferLabel}
          <text class="buffer-label" x={bufferLabel.x} y={bufferLabel.y} text-anchor={bufferLabel.anchor}>
            Safety buffer {formatPeso(bufferCentavos)}
          </text>
        {/if}
        {#if gipit}
          <text class="gipit-label" x={gipit.labelX} y={gipit.labelY} text-anchor="middle">{gipit.text}</text>
        {/if}

        <line class="scan" x1={selX} x2={selX} y1={-padTop} y2={landBottom} />
        <g transform="translate({selX} {selY})">
          <circle class="halo" r="15" />
          <circle class="knob" r="7" />
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
      style="--pad-x: {PAD_X}px; --pad-right: {padRight}px; --thumb: {THUMB}px"
      oninput={(e) => choose(clampDay(Number(e.currentTarget.value)))}
      onkeydown={onKey}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerCancel}
      onlostpointercapture={onPointerCancel}
    />
  {/if}
</div>

<style>
  .ridge {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .ridge:has(.scrub:focus-visible) .scan {
    stroke-opacity: 1;
    stroke-width: 2;
  }

  .art {
    position: absolute;
    inset: 0;
    display: block;
    overflow: visible;
  }
  .art.reveal {
    animation: reveal 1100ms var(--ease-out) backwards;
  }
  @keyframes reveal {
    from {
      clip-path: inset(0 100% 0 0);
    }
    to {
      clip-path: inset(0 0 0 0);
    }
  }

  .land-top {
    stop-color: var(--ridge-top);
  }
  .land-mid {
    stop-color: var(--ridge-mid);
  }
  .land-bottom {
    stop-color: var(--ridge-bottom);
  }
  .rim-start {
    stop-color: var(--rim-start);
  }
  .rim-mid {
    stop-color: var(--rim-mid);
  }
  .rim-end {
    stop-color: var(--rim-end);
  }
  .rim {
    fill: none;
    stroke-width: 1.75;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .rim.low {
    stroke: var(--coral);
    stroke-width: 2;
  }
  .zero {
    stroke: var(--muted);
    stroke-opacity: 0.6;
  }
  .buffer {
    stroke: var(--coral-text);
    stroke-opacity: 0.5;
    stroke-dasharray: 2 6;
    stroke-linecap: round;
  }
  .buffer-label,
  .gipit-label {
    font-size: 13px;
    font-weight: 700;
    fill: var(--land-label);
    paint-order: stroke;
    stroke: var(--ridge-mid);
    stroke-width: 7px;
    stroke-linejoin: round;
  }
  .buffer-label {
    font-weight: 600;
  }
  .tick {
    stroke: var(--muted-2);
    stroke-opacity: 0.6;
  }
  .tick.payday {
    stroke-opacity: 0.35;
  }
  .tick-label {
    font-size: 12.5px;
    font-weight: 700;
    fill: var(--text);
    fill-opacity: 0.8;
  }
  .today {
    stroke: var(--muted);
    stroke-opacity: 0.5;
    stroke-dasharray: 2 4;
  }
  .whatif {
    fill: none;
    stroke: var(--muted);
    stroke-opacity: 0.6;
    stroke-width: 1.5;
    stroke-dasharray: 6 5;
    stroke-linejoin: round;
  }
  .gipit {
    fill: var(--coral);
    stroke: var(--ridge-mid);
    stroke-width: 2.5;
  }
  .scan {
    stroke: var(--mango);
    stroke-opacity: 0.55;
    stroke-width: 1.25;
  }
  .knob {
    fill: var(--mango);
    stroke: var(--ridge-mid);
    stroke-width: 3;
    transform-box: fill-box;
    transform-origin: center;
    transition: transform 140ms var(--ease-out);
  }
  .halo {
    fill: var(--mango);
    fill-opacity: 0;
    transition: fill-opacity 160ms ease-out;
  }
  .ridge.dragging .halo,
  .ridge:has(.scrub:focus-visible) .halo {
    fill-opacity: 0.22;
  }
  .ridge.dragging .knob {
    transform: scale(1.15);
  }

  /* The real control: a transparent range input over the land. Its thumb is
     2px wide and its box is inset by the plot padding, so value → x matches
     the drawn scrubber. */
  .scrub {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--pad-x) - var(--thumb) / 2);
    width: calc(100% - 2 * var(--pad-x) - var(--pad-right) + var(--thumb));
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
</style>
