<script lang="ts">
  import ScreenGate from '../components/ScreenGate.svelte';
  import { app } from '../lib/state.svelte';
  import { planLanes } from '../lib/plans';
  import { formatPeso, toCentavos } from '../lib/money';
  import { daysBetween, formatMonthTick, formatMonthYear, formatShort, nextMonthStart, yearOf } from '../lib/dates';

  const p = $derived(app.projection);
  const buffer = $derived(toCentavos(app.settings.safetyBuffer));
  const thisYear = $derived(yearOf(app.today));
  const n = $derived(p?.days.length ?? 0);
  const span = $derived(Math.max(1, n - 1));

  /** Position (0 to 100) of a date across the projection window. */
  const pos = (iso: string) => (p ? Math.min(100, Math.max(0, (daysBetween(p.start, iso) / span) * 100)) : 0);

  // ---- lanes ----
  const lanes = $derived(p ? planLanes(p, app.items) : []);

  /** Month ticks along the lane axis: about four of them, kept off the very edges. */
  const ticks = $derived.by(() => {
    if (!p) return [] as { left: number; label: string }[];
    const every = n > 400 ? 6 : 3;
    const out: { left: number; label: string }[] = [];
    let d = nextMonthStart(p.start);
    let k = 0;
    while (daysBetween(p.start, d) <= n - 1) {
      const left = pos(d);
      if (left > 6 && left < 94 && k % every === 0) {
        out.push({ left, label: formatMonthTick(d, yearOf(d) !== yearOf(p.start)) });
      }
      d = nextMonthStart(d);
      k++;
    }
    return out;
  });

  const laneNote = (l: ReturnType<typeof planLanes>[number]) =>
    l.kind === 'paluwagan' && l.payout
      ? `Payout ${formatShort(l.payout, thisYear)} · last hulog ${formatShort(l.last, thisYear)}`
      : `Last hulog ${formatShort(l.last, thisYear)}`;

  // ---- months ----
  const months = $derived.by(() => {
    if (!p) return null;
    const rows = p.monthEnds;
    let lo = 0;
    let hi = buffer;
    for (const m of rows) {
      if (m.centavos < lo) lo = m.centavos;
      if (m.centavos > hi) hi = m.centavos;
    }
    const range = Math.max(1, hi - lo);
    const zero = (-lo / range) * 100;
    return {
      zero,
      buffer: ((buffer - lo) / range) * 100,
      hasNeg: lo < 0,
      rows: rows.map((m) => {
        const w = m.centavos === 0 ? 0 : Math.max(1.2, (Math.abs(m.centavos) / range) * 100);
        return {
          label: formatMonthYear(`${m.month}-01`),
          centavos: m.centavos,
          left: m.centavos >= 0 ? zero : zero - w,
          width: w,
          level: m.centavos < 0 ? ('neg' as const) : m.centavos < buffer ? ('low' as const) : ('ok' as const),
        };
      }),
    };
  });
</script>

<h1 class="sr-only">Plans</h1>

<ScreenGate
  emptyTitle="Add your hulog and bills to see your plans"
  emptyBody="Lantaw shows when each installment and paluwagan ends, and your balance at the end of every month. Nothing leaves your device."
>
  {#if p && months}
    <div class="page">
      <section class="card" aria-labelledby="lanes-h">
        <h2 id="lanes-h" class="kicker">Installments and paluwagan</h2>

        {#if lanes.length > 0}
          <div class="axis" aria-hidden="true">
            {#each ticks as t (t.left)}<span style="left:{t.left}%">{t.label}</span>{/each}
          </div>
          <ul class="lanes">
            {#each lanes as l (l.itemId)}
              <li class="lane" class:whatif={!l.included} class:pal={l.kind === 'paluwagan'}>
                <div class="lane-text">
                  <span class="lane-name">{l.name}</span>
                  <span class="lane-note">{!l.included ? 'What-if, not counted · ' : ''}{laneNote(l)}</span>
                </div>
                <div class="track" aria-hidden="true">
                  <i class="fill" style="left:{pos(l.first)}%; width:{Math.max(1.5, pos(l.last) - pos(l.first))}%"></i>
                  <em class="finish" style="left:{pos(l.last)}%"></em>
                  {#if l.payout}
                    <svg class="star" style="left:{pos(l.payout)}%" viewBox="0 0 12 12">
                      <path d="M6 1l1.5 3.2l3.5.4l-2.6 2.4l.7 3.5L6 8.8L2.9 10.5l.7-3.5L1 4.6l3.5-.4z" />
                    </svg>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
          <p class="legend">
            <span class="key"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1l1.5 3.2l3.5.4l-2.6 2.4l.7 3.5L6 8.8L2.9 10.5l.7-3.5L1 4.6l3.5-.4z" /></svg> Paluwagan payout</span>
            <span class="key"><i class="tick" aria-hidden="true"></i> Last payment</span>
            <span class="key"><i class="dashed" aria-hidden="true"></i> What-if</span>
          </p>
        {:else}
          <p class="quiet">No installments or paluwagan in your forecast. Add one in Items and its end date shows here.</p>
        {/if}
      </section>

      <section class="card" aria-labelledby="months-h">
        <h2 id="months-h" class="kicker">Month by month</h2>
        <p class="sub-h">Your balance on the last day of each month.</p>
        <ul class="months">
          {#each months.rows as m (m.label)}
            <li class="month {m.level}">
              <span class="m-label">{m.label}</span>
              <div class="m-track" aria-hidden="true">
                {#if months.hasNeg}<b class="zero" style="left:{months.zero}%"></b>{/if}
                <b class="buf" style="left:{months.buffer}%"></b>
                <i style="left:{m.left}%; width:{m.width}%"></i>
              </div>
              <span class="m-val">{formatPeso(m.centavos)}</span>
              {#if m.level !== 'ok'}
                <span class="m-flag">{m.level === 'neg' ? 'Below ₱0' : `Below your ${formatPeso(buffer)} buffer`}</span>
              {/if}
            </li>
          {/each}
        </ul>
        <p class="legend">
          <span class="key"><i class="dashed-v" aria-hidden="true"></i> Safety buffer {formatPeso(buffer)}</span>
        </p>
      </section>
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
  .sub-h {
    margin: 2px 0 0;
    font-size: 0.875rem;
    color: var(--muted);
  }
  .quiet {
    margin: 12px 0 0;
    color: var(--muted);
    font-size: 0.9375rem;
  }

  .page {
    display: grid;
    gap: 14px;
    max-width: 56rem;
    padding: 12px 16px 24px;
    align-items: start;
  }
  .card {
    min-width: 0;
    padding: 16px;
    border-radius: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  @media (min-width: 1024px) {
    .page {
      gap: 20px;
      padding: 32px;
    }
  }
  @media (min-width: 1280px) {
    .page {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      max-width: 76rem;
    }
  }

  /* ---------- lanes ---------- */
  .axis {
    position: relative;
    height: 22px;
    margin-top: 10px;
  }
  .axis span {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--muted);
    white-space: nowrap;
  }
  .lanes {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .lane {
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
  }
  .lane:last-child {
    border-bottom: 0;
  }
  .lane-text {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0 12px;
  }
  .lane-name {
    font-size: 0.9375rem;
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .lane-note {
    font-size: 0.875rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .whatif .lane-name,
  .whatif .lane-note {
    font-style: italic;
  }
  .track {
    position: relative;
    height: 12px;
    margin-top: 8px;
    border-radius: 6px;
    background: var(--surface-2);
  }
  .fill {
    position: absolute;
    top: 2px;
    height: 8px;
    border-radius: 4px;
    background: var(--teal);
  }
  .pal .fill {
    background: var(--mango);
  }
  .whatif .fill {
    top: 1px;
    height: 10px;
    background: transparent;
    border: 2px dashed var(--teal);
  }
  .whatif.pal .fill {
    border-color: var(--mango);
  }
  .finish {
    position: absolute;
    top: -4px;
    width: 3px;
    height: 20px;
    margin-left: -1.5px;
    border-radius: 2px;
    background: var(--text);
  }
  .star {
    position: absolute;
    top: -9px;
    width: 18px;
    height: 18px;
    margin-left: -9px;
    fill: var(--mango);
    stroke: var(--surface);
    stroke-width: 0.8;
    stroke-linejoin: round;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin: 12px 0 0;
    font-size: 0.875rem;
    color: var(--muted);
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .key svg {
    width: 14px;
    height: 14px;
    fill: var(--mango);
  }
  .tick {
    width: 3px;
    height: 14px;
    border-radius: 2px;
    background: var(--text);
  }
  .dashed {
    width: 18px;
    height: 10px;
    border-radius: 4px;
    border: 2px dashed var(--teal);
  }
  .dashed-v {
    width: 0;
    height: 14px;
    border-left: 2px dashed var(--muted);
  }

  /* ---------- months ---------- */
  .months {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
  }
  .month {
    display: grid;
    grid-template-columns: 4.4rem minmax(0, 1fr) 5.6rem;
    align-items: center;
    gap: 4px 10px;
    padding: 7px 0;
    font-variant-numeric: tabular-nums;
  }
  .m-label {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--muted);
    white-space: nowrap;
  }
  .m-track {
    position: relative;
    height: 12px;
    border-radius: 6px;
    background: var(--surface-2);
  }
  .m-track i {
    position: absolute;
    top: 0;
    height: 100%;
    border-radius: 6px;
    background: var(--teal);
  }
  .low .m-track i,
  .neg .m-track i {
    background: var(--coral);
  }
  .m-track b {
    position: absolute;
    top: -3px;
    height: 18px;
    z-index: 1;
  }
  .m-track .buf {
    border-left: 2px dashed var(--muted);
  }
  .m-track .zero {
    border-left: 2px solid var(--text);
  }
  .m-val {
    text-align: right;
    font-size: 0.9375rem;
    font-weight: 800;
  }
  .low .m-val,
  .neg .m-val {
    color: var(--coral-text);
  }
  .m-flag {
    grid-column: 2 / -1;
    margin-top: -2px;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--coral-text);
  }
</style>
