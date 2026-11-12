<script lang="ts">
  import ScreenGate from '../components/ScreenGate.svelte';
  import { app } from '../lib/state.svelte';
  import { areaPath, downsample } from '../lib/chart';
  import { movedReason } from '../lib/cutoff';
  import { formatPeso, toCentavos } from '../lib/money';
  import { addDays, daysBetween, formatDayRange, formatMonthYear, formatShort, weekday, yearOf } from '../lib/dates';

  const p = $derived(app.projection);
  const buffer = $derived(toCentavos(app.settings.safetyBuffer));
  const thisYear = $derived(yearOf(app.today));
  const itemById = $derived(new Map(app.items.map((i) => [i.id, i])));
  const cutoffs = $derived(p?.cutoffs ?? []);
  const count = $derived(cutoffs.length);

  // ---- which cutoff: the one containing today unless the user stepped ----
  let picked = $state<number | null>(null);
  const todayIdx = $derived.by(() => {
    if (!p) return 0;
    let k = 0;
    for (let j = 0; j < cutoffs.length && cutoffs[j].payday <= app.today; j++) k = j;
    return k;
  });
  const idx = $derived(Math.min(Math.max(picked ?? todayIdx, 0), Math.max(0, count - 1)));
  const cutoff = $derived(cutoffs[idx] ?? null);
  const next = $derived(cutoffs[idx + 1] ?? null);
  const isCurrent = $derived(!!cutoff && cutoff.payday <= app.today && app.today <= cutoff.end);

  function step(dir: 1 | -1) {
    picked = Math.min(Math.max(idx + dir, 0), count - 1);
  }
  function onKey(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'ArrowLeft' && idx > 0) {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'ArrowRight' && idx < count - 1) {
      e.preventDefault();
      step(1);
    }
  }

  // ---- this cutoff's numbers ----
  const events = $derived(cutoff && p ? cutoff.eventIndices.map((i) => p.events[i]) : []);
  const isSweldo = (itemId: string) => {
    const k = itemById.get(itemId)?.kind;
    return k?.type === 'income' && k.mainSweldo;
  };
  const sweldoEvents = $derived(events.filter((e) => e.included && isSweldo(e.itemId)));
  const sweldo = $derived(sweldoEvents.reduce((a, e) => a + e.centavos, 0));
  const rows = $derived(events.filter((e) => !(e.included && isSweldo(e.itemId))));
  const billCount = $derived(events.filter((e) => e.included && e.centavos < 0).length);
  const moved = $derived(cutoff ? movedReason(cutoff) : '');
  const left = $derived(cutoff?.leftCentavos ?? 0);
  const leftDate = $derived(cutoff ? addDays(cutoff.end, 1) : '');
  const isLast = $derived(idx >= count - 1);
  const usedPct = $derived(
    cutoff && cutoff.incomeCentavos > 0 ? Math.round((cutoff.outflowCentavos / cutoff.incomeCentavos) * 100) : 0,
  );

  const fmtDay = (iso: string) => `${weekday(iso)} ${formatShort(iso, thisYear)}`;
  const signed = (c: number) => (c > 0 ? `+${formatPeso(c)}` : formatPeso(c));

  // ---- sparkline of the whole forecast ----
  const SW = 600;
  const SH = 56;
  const PX = 6;
  const PY = 6;
  const n = $derived(p?.days.length ?? 0);
  const spark = $derived.by(() => {
    if (!p || n === 0) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of p.days) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const pts = downsample(p.days, 160);
    const w = SW - 2 * PX;
    const h = SH - 2 * PY;
    const { line, area } = areaPath(pts, w, h, lo, hi);
    const x = (i: number) => PX + (n <= 1 ? 0 : (i / (n - 1)) * w);
    const y = (v: number) => PY + (hi === lo ? h / 2 : h - ((v - lo) / (hi - lo)) * h);
    return { line, area, x, y };
  });
  const bandX = $derived.by(() => {
    if (!spark || !p || !cutoff) return null;
    const a = Math.max(0, daysBetween(p.start, cutoff.payday));
    const b = Math.min(n - 1, daysBetween(p.start, cutoff.end));
    const x1 = spark.x(a);
    return { x: x1, w: Math.max(3, spark.x(b) - x1) };
  });
  const todayPt = $derived.by(() => {
    if (!spark || !p) return null;
    const i = daysBetween(p.start, app.today);
    return i >= 0 && i < n ? { x: spark.x(i), y: spark.y(p.days[i]) } : null;
  });
  const sparkLabel = $derived(
    p && n > 0
      ? `Balance over the forecast, from ${formatPeso(p.days[0])} to ${formatPeso(p.days[n - 1])}. The highlighted band is the cutoff shown below.`
      : '',
  );
</script>

<h1 class="sr-only">Cutoffs</h1>

<ScreenGate
  emptyTitle="Add your sweldo and bills to see your cutoffs"
  emptyBody="Lantaw groups your money by payday, so you can see which bills each sweldo covers and what’s left. Nothing leaves your device."
>
  {#if p && cutoff && spark}
    <div class="page">
      <figure class="spark">
        <svg viewBox="0 0 {SW} {SH}" preserveAspectRatio="none" role="img" aria-label={sparkLabel}>
          {#if bandX}<rect class="band" x={bandX.x} y="0" width={bandX.w} height={SH} />{/if}
          <path class="area" d={spark.area} transform="translate({PX} {PY})" />
          <path class="line" d={spark.line} transform="translate({PX} {PY})" vector-effect="non-scaling-stroke" />
        </svg>
        {#if todayPt}
          <span class="today" style="left:{(todayPt.x / SW) * 100}%; top:{(todayPt.y / SH) * 100}%" aria-hidden="true"></span>
        {/if}
        <figcaption class="spark-cap">
          <span>{formatShort(p.start, thisYear)}</span>
          <span>{formatMonthYear(addDays(p.start, n - 1))}</span>
        </figcaption>
      </figure>

      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="stage"
        role="group"
        aria-label="Cutoff {idx + 1} of {count}. Use the left and right arrow keys to change cutoff."
        tabindex="0"
        onkeydown={onKey}
      >
        <header class="bar">
          <h2 class="kicker" aria-live="polite">
            {isCurrent ? 'This cutoff' : 'Cutoff'} · {formatDayRange(cutoff.payday, cutoff.end)}
          </h2>
          <div class="steps">
            <button type="button" class="step" aria-label="Previous cutoff" disabled={idx === 0} onclick={() => step(-1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7l7 7" /></svg>
            </button>
            <button type="button" class="step" aria-label="Next cutoff" disabled={isLast} onclick={() => step(1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7l-7 7" /></svg>
            </button>
          </div>
        </header>

        <section class="hero" aria-label="Sweldo">
          <p class="kicker">{sweldoEvents.length > 0 ? 'Sweldo' : 'Payday'} · {fmtDay(cutoff.payday)}</p>
          {#if sweldoEvents.length > 0}
            <p class="big">{formatPeso(sweldo)}</p>
          {:else}
            <p class="big none">No sweldo in this cutoff</p>
          {/if}
          {#if moved}<p class="moved">{moved}</p>{/if}
          <p class="covers">
            Covers {billCount}
            {billCount === 1 ? 'bill' : 'bills'} ·
            <strong class:low={left < buffer}>{formatPeso(left)}</strong>
            {isLast ? `left on ${formatShort(cutoff.end, thisYear)}` : `left before ${formatShort(leftDate, thisYear)}`}
          </p>
          {#if cutoff.incomeCentavos > 0}
            <div class="meter" aria-hidden="true">
              <i class:over={usedPct > 100} style="width:{Math.min(100, usedPct)}%"></i>
            </div>
            <p class="meter-text">Bills take {usedPct}% of this cutoff’s income</p>
          {/if}
        </section>

        <section class="list" aria-label="Bills in this cutoff">
          {#if rows.length > 0}
            <ul class="events">
              {#each rows as e, k (k)}
                <li class:whatif={!e.included}>
                  <span class="when">{formatShort(e.date)}</span>
                  <span class="what">
                    <span class="name">
                      {#if !e.included}
                        <svg class="dash" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.25" /></svg>
                      {/if}{e.name}
                    </span>
                    {#if e.note || !e.included}
                      <span class="sub">{[!e.included ? 'what-if, not counted' : '', e.note ?? ''].filter(Boolean).join(' · ')}</span>
                    {/if}
                  </span>
                  <span class="amt" class:pos={e.centavos > 0}>{signed(e.centavos)}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="quiet">Nothing due in this cutoff.</p>
          {/if}
          <dl class="totals">
            <div><dt>In</dt><dd class="pos">+{formatPeso(cutoff.incomeCentavos)}</dd></div>
            <div><dt>Out</dt><dd>{formatPeso(-cutoff.outflowCentavos)}</dd></div>
          </dl>
        </section>
      </div>

      {#if next}
        <button type="button" class="next" onclick={() => step(1)}>
          <span class="kicker">Next · Sweldo {fmtDay(next.payday)}</span>
          <span class="next-line">
            {formatPeso(next.incomeCentavos)} in →
            <strong class:low={next.leftCentavos < buffer}>{formatPeso(next.leftCentavos)}</strong> left
          </span>
        </button>
      {/if}
    </div>
  {/if}
</ScreenGate>

<style>
  .kicker {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--muted);
  }
  .pos {
    color: var(--teal-text);
  }
  .low {
    color: var(--coral-text);
  }

  .page {
    display: grid;
    gap: 14px;
    max-width: 44rem;
    padding: 12px 16px 24px;
  }
  @media (min-width: 1024px) {
    .page {
      gap: 18px;
      padding: 32px;
    }
  }

  /* ---------- sparkline ---------- */
  .spark {
    position: relative;
    margin: 0;
  }
  .spark svg {
    display: block;
    width: 100%;
    height: 56px;
    overflow: visible;
  }
  .band {
    fill: var(--mango);
    fill-opacity: 0.2;
  }
  .area {
    fill: var(--teal);
    fill-opacity: 0.16;
  }
  .line {
    fill: none;
    stroke: var(--teal);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .today {
    position: absolute;
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    border-radius: 50%;
    background: var(--mango);
    border: 2px solid var(--bg);
  }
  .spark-cap {
    display: flex;
    justify-content: space-between;
    margin-top: 2px;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--muted);
  }

  /* ---------- the cutoff card ---------- */
  .stage {
    border-radius: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 16px;
    min-width: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .steps {
    display: flex;
    gap: 4px;
    margin: -6px -6px -6px 0;
  }
  .step {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }
  .step:hover:not(:disabled) {
    background: var(--surface-2);
  }
  .step:disabled {
    color: var(--muted);
    cursor: default;
  }
  .step svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .hero {
    margin-top: 12px;
    padding: 16px;
    border-radius: 14px;
    background: var(--surface-2);
  }
  .big {
    margin: 2px 0 0;
    font-size: clamp(2.25rem, 9vw, 3rem);
    font-weight: 800;
    letter-spacing: -0.035em;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .big.none {
    font-size: 1.25rem;
    letter-spacing: -0.01em;
    color: var(--muted);
  }
  .moved {
    margin: 6px 0 0;
    font-size: 0.875rem;
    font-weight: 600;
  }
  .covers {
    margin: 8px 0 12px;
    font-size: 0.9375rem;
    font-variant-numeric: tabular-nums;
  }
  .meter {
    height: 8px;
    border-radius: 8px;
    background: var(--border);
    overflow: hidden;
  }
  .meter i {
    display: block;
    height: 100%;
    border-radius: 8px;
    background: var(--mango);
    transition: width 220ms ease-out;
  }
  .meter i.over {
    background: var(--coral);
  }
  .meter-text {
    margin: 6px 0 0;
    font-size: 0.875rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .events {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
  }
  .events li {
    display: grid;
    grid-template-columns: 3.9rem minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.9375rem;
  }
  .events li:last-child {
    border-bottom: 0;
  }
  .when {
    color: var(--muted);
    font-size: 0.875rem;
    font-weight: 600;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .name {
    display: block;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .sub {
    display: block;
    font-size: 0.875rem;
    color: var(--muted);
  }
  .amt {
    font-weight: 800;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .whatif .name,
  .whatif .amt {
    font-style: italic;
  }
  .whatif .amt {
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }
  .dash {
    display: inline-block;
    width: 12px;
    height: 12px;
    margin-right: 6px;
    vertical-align: -1px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.5;
    stroke-dasharray: 2.5 2;
  }
  .quiet {
    margin: 12px 0 0;
    color: var(--muted);
    font-size: 0.9375rem;
  }
  .totals {
    margin: 8px 0 0;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .totals div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 0;
    font-size: 0.9375rem;
  }
  .totals dt {
    color: var(--muted);
    font-weight: 600;
  }
  .totals dd {
    margin: 0;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  /* ---------- next cutoff ---------- */
  .next {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: 12px 16px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 160ms ease-out;
  }
  .next:hover {
    background: var(--surface);
  }
  .next-line {
    font-size: 1rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
</style>
