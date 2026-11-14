<script lang="ts">
  import Chart from '../components/Chart.svelte';
  import Chip from '../components/Chip.svelte';
  import ForecastNotice from '../components/ForecastNotice.svelte';
  import Range from '../components/Range.svelte';
  import TimeBar from '../components/TimeBar.svelte';
  import { app } from '../lib/state.svelte';
  import type { EngineEvent } from '../lib/engine-types';
  import { isBalanceStale } from '../lib/input';
  import { nextCutoffIndex } from '../lib/chart';
  import { movedReason } from '../lib/cutoff';
  import { formatPeso, toCentavos } from '../lib/money';
  import {
    addDays,
    daysBetween,
    formatCompact,
    formatDate,
    formatDayRange,
    formatMonthYear,
    formatShort,
    weekday,
    yearOf,
  } from '../lib/dates';

  const p = $derived(app.projection);
  const s = $derived(app.settings);
  const buffer = $derived(toCentavos(s.safetyBuffer));
  const thisYear = $derived(yearOf(app.today));
  const n = $derived(p?.days.length ?? 0);

  // ---- selection (cheap reads only; the projection is precomputed) ----
  const sel = $derived(Math.min(Math.max(app.selectedDay, 0), Math.max(0, n - 1)));
  const selDate = $derived(p ? addDays(p.start, sel) : app.today);
  const balance = $derived(p?.days[sel] ?? 0);

  const rawToday = $derived(p ? daysBetween(p.start, app.today) : 0);
  const todayInRange = $derived(p !== null && rawToday >= 0 && rawToday < n);
  const refIdx = $derived(todayInRange ? rawToday : 0);
  const refLabel = $derived(todayInRange || !p ? 'today' : formatShort(p.start, thisYear));
  const isToday = $derived(todayInRange && sel === rawToday);
  const delta = $derived(p ? balance - p.days[refIdx] : 0);

  const deltaText = $derived.by(() => {
    if (delta === 0) return isToday ? 'Drag the land or press play to look ahead' : `Same as ${refLabel}`;
    return `${delta > 0 ? '+' : ''}${formatPeso(delta)} vs ${refLabel}`;
  });

  // The balance figure, split so the peso sign and centavos can sit smaller.
  const figure = $derived.by(() => {
    const text = formatPeso(balance);
    const m = /^([−-]?)₱([\d,]+)(\.\d+)?$/.exec(text);
    return m ? { sign: m[1], whole: m[2], cents: m[3] ?? '' } : { sign: '', whole: text.replace('₱', ''), cents: '' };
  });

  // ---- the cutoff that contains the selected day ----
  const cutoffStarts = $derived(p ? p.cutoffs.map((c) => daysBetween(p.start, c.payday)) : []);
  const cutIdx = $derived.by(() => {
    let k = 0;
    for (let j = 0; j < cutoffStarts.length && cutoffStarts[j] <= sel; j++) k = j;
    return k;
  });
  const cutoff = $derived(p?.cutoffs[cutIdx] ?? null);
  const isLastCutoff = $derived(p ? cutIdx === p.cutoffs.length - 1 : true);
  const cutEvents = $derived(cutoff && p ? cutoff.eventIndices.map((i) => p.events[i]) : []);

  const movedNote = $derived(cutoff ? movedReason(cutoff) : '');

  // ---- the sentence under the balance: what happens on the selected day ----
  const STORY_MAX = 3;
  const dayEvents = $derived(p ? p.events.filter((e) => e.date === selDate && e.included) : []);
  const nextEvent = $derived(p ? (p.events.find((e) => e.date > selDate && e.included) ?? null) : null);
  const isPayday = $derived(cutoff !== null && cutoffStarts[cutIdx] === sel);
  const isGipitDay = $derived(p?.gipit?.date === selDate);
  const gipitCauses = $derived(
    p?.gipit && isGipitDay ? p.gipit.causes.map((id) => itemById.get(id)?.name).filter(Boolean).join(', ') : '',
  );

  // ---- chips ----
  const finish = $derived(p?.finishLines.find((f) => f.lastPayment >= app.today) ?? null);

  // ---- coming up: big one-offs, extra income, payouts and finish lines after this cutoff ----
  const itemById = $derived(new Map(app.items.map((i) => [i.id, i])));

  type Upcoming = { date: string; label: string; amount: string; tone: 'pos' | 'neg' | 'done' };
  const upcoming = $derived.by((): Upcoming[] => {
    if (!p || !cutoff) return [];
    const after = cutoff.end;
    const out: Upcoming[] = [];
    for (const e of p.events) {
      if (e.date <= after || !e.included) continue;
      const it = itemById.get(e.itemId);
      if (!it) continue;
      const k = it.kind;
      const big =
        k.type === 'oneOff' ||
        (k.type === 'income' && !k.mainSweldo) ||
        (k.type === 'paluwagan' && e.centavos > 0);
      if (big) {
        const label = k.type === 'paluwagan' ? `${e.name} payout` : e.name;
        out.push({ date: e.date, label, amount: signed(e.centavos), tone: e.centavos > 0 ? 'pos' : 'neg' });
      }
    }
    for (const f of p.finishLines) {
      if (f.lastPayment > after) {
        out.push({ date: f.lastPayment, label: `${f.name} done`, amount: `+${formatPeso(f.freesPerMonthCentavos)}/mo`, tone: 'done' });
      }
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(0, 6);
  });

  // ---- banners ----
  const stale = $derived(isBalanceStale(s.balanceAsOf, app.today));

  let clearing = $state(false);
  let clearFailed = $state(false);
  async function clearSample() {
    if (clearing) return;
    clearing = true;
    clearFailed = false;
    try {
      await app.clearSample();
    } catch {
      clearFailed = true;
    } finally {
      clearing = false;
    }
  }

  // ---- play: walk the forecast a day at a time, about ten seconds end to end ----
  let playing = $state(false);
  let raf = 0;

  function stopPlay() {
    playing = false;
    cancelAnimationFrame(raf);
  }

  function togglePlay() {
    if (playing) return stopPlay();
    if (!p || n < 2) return;
    if (sel >= n - 1) app.selectedDay = refIdx;
    playing = true;
    const msPerDay = 10_000 / n;
    let last = performance.now();
    const step = (t: number) => {
      if (!playing) return;
      const days = Math.floor((t - last) / msPerDay);
      if (days > 0) {
        last += days * msPerDay;
        const next = Math.min(n - 1, sel + days);
        app.selectedDay = next;
        if (next >= n - 1) return stopPlay();
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  $effect(() => () => cancelAnimationFrame(raf));

  // At 1024px and wider the time bar floats over the land, so the ridge leaves room under it.
  const WIDE = '(min-width: 1024px)';
  let wide = $state(typeof matchMedia === 'function' && matchMedia(WIDE).matches);
  $effect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(WIDE);
    const on = () => (wide = mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });

  // ---- helpers ----
  function signed(c: number): string {
    return c > 0 ? `+${formatPeso(c)}` : formatPeso(c);
  }

  function jumpTo(date: string) {
    if (!p) return;
    stopPlay();
    app.selectedDay = Math.min(Math.max(daysBetween(p.start, date), 0), n - 1);
  }

  function stepCutoff(dir: 1 | -1) {
    if (!p) return;
    stopPlay();
    app.selectedDay = Math.min(Math.max(nextCutoffIndex(sel, p.cutoffs, p.start, dir), 0), n - 1);
  }

  function setHorizon(months: 12 | 24) {
    if (s.horizonMonths !== months) void app.updateSettings({ horizonMonths: months });
  }

  const eventDay = (e: EngineEvent) => (p ? daysBetween(p.start, e.date) : -1);
</script>

<h1 class="sr-only">Timeline</h1>

{#if app.status === 'loading'}
  <div class="loading" aria-busy="true">
    <p>Loading your forecast…</p>
    <div class="skeleton"></div>
  </div>
{:else if app.status === 'failed'}
  <section class="notice error" role="alert">
    <h2>Lantaw couldn’t start</h2>
    {#if app.failure === 'storage'}
      <p>
        It can’t open its storage on this device. Private browsing or blocked site data can cause this. Allow site data
        for Lantaw, or use a normal window, then reload.
      </p>
    {:else}
      <p>Its forecasting engine didn’t load. Reload the page to try again. Your data is safe on this device.</p>
    {/if}
  </section>
{:else if app.items.length === 0}
  <section class="empty">
    <svg class="mark" viewBox="0 0 240 90" aria-hidden="true">
      <path class="mark-fill" d="M0 70 L40 52 L64 58 L104 22 L120 30 L150 46 L184 38 L240 50 L240 90 L0 90 Z" />
      <path class="mark-line" d="M0 70 L40 52 L64 58 L104 22 L120 30 L150 46 L184 38 L240 50" />
      <circle class="mark-dot" cx="104" cy="22" r="6" />
    </svg>
    <h2>Add your sweldo and bills to see your forecast</h2>
    <p>Lantaw draws your balance day by day for the next {s.horizonMonths} months, so you can see a gipit day coming. Nothing leaves your device.</p>
    <a class="btn primary" href="#/items">Add items</a>
  </section>
{:else}
  <div class="tl">
    <section class="scene" aria-label="Forecast">
      <Range />

      <div class="readout">
        {#if s.isSample}
          <div class="banner sample">
            <p><strong>Sample budget</strong> · made-up Davao data</p>
            <button
              type="button"
              class="btn ghost small"
              aria-label="Clear sample budget"
              onclick={clearSample}
              disabled={clearing}
              aria-busy={clearing || undefined}
            >
              Clear
            </button>
            {#if clearFailed}
              <p class="field-error" role="alert">Couldn’t clear the sample on this device. Try again.</p>
            {/if}
          </div>
        {/if}

        <ForecastNotice />

        {#if app.balanceCheck}
          <section class="banner" aria-labelledby="balance-check-h">
            <p id="balance-check-h">
              <strong>Your backup’s balance couldn’t be read — please check it in Settings.</strong>
              Until then, the forecast starts from {formatPeso(toCentavos(s.balance))} on {formatDate(s.balanceAsOf)}.
            </p>
            <div class="banner-actions">
              <a class="btn primary small" href="#/settings">Check balance</a>
              <button type="button" class="btn ghost small" onclick={() => (app.balanceCheck = false)}>Dismiss</button>
            </div>
          </section>
        {/if}

        {#if stale && p}
          <section class="banner" aria-label="Balance reminder">
            <p>
              <strong>Update your balance?</strong>
              {#if p.expectedToday !== null}
                Lantaw expected about {formatPeso(p.expectedToday)} today.
              {:else}
                You last set it on {formatDate(s.balanceAsOf)}.
              {/if}
            </p>
            <a class="btn ghost small" href="#/settings">Update</a>
          </section>
        {/if}

        {#if p}
          <div aria-live="polite">
            <p class="when">
              {#if isToday}
                <b>Today</b> · {weekday(selDate)}, {formatShort(selDate)}
              {:else}
                <b>{weekday(selDate)}, {formatShort(selDate, thisYear)}</b> · {deltaText}
              {/if}
            </p>
            <p class="big" class:low={balance < buffer} data-testid="balance">
              {figure.sign}<span class="cur">₱</span>{figure.whole}{#if figure.cents}<span class="cents">{figure.cents}</span>{/if}
            </p>
            <p class="story">
              {#if isGipitDay}<strong>Your lowest point in this forecast.</strong>{' '}{/if}
              {#if isPayday && movedNote}<span class="moved-inline">{movedNote}</span>{' '}{/if}
              {#if dayEvents.length > 0}
                {#each dayEvents.slice(0, STORY_MAX) as e, k (k)}{e.name}
                  <span class="amt-inline" class:pos={e.centavos > 0}>{signed(e.centavos)}</span>{k < Math.min(dayEvents.length, STORY_MAX) - 1 ? ', ' : ''}{/each}{dayEvents.length > STORY_MAX ? `, and ${dayEvents.length - STORY_MAX} more` : ''}.
              {:else if nextEvent}
                A quiet day. Next up: <strong>{nextEvent.name}</strong> on {formatShort(nextEvent.date, thisYear)}.
              {:else}
                Nothing scheduled after this day.
              {/if}
              {#if gipitCauses}{' '}Biggest costs this cutoff: {gipitCauses}.{/if}
            </p>
            {#if isToday}<p class="sr-only">{deltaText}</p>{/if}
          </div>

          <div class="chips">
            {#if p.gipit}
              <Chip tone="coral" icon="dot" title="Lowest balance. Show this day." onclick={() => jumpTo(p.gipit!.date)}>
                Gipit day · {formatShort(p.gipit.date, thisYear)} · {formatPeso(p.gipit.centavos)}
              </Chip>
            {/if}
            {#if finish}
              <Chip tone="teal" icon="flag" title="Last payment. Show this day." onclick={() => jumpTo(finish.lastPayment)}>
                {finish.name} done {formatMonthYear(finish.lastPayment)} · +{formatPeso(finish.freesPerMonthCentavos)}/mo
              </Chip>
            {/if}
            {#if p.firstBelowBuffer}
              <Chip tone="mango" icon="down" title="First day under your safety buffer. Show this day." onclick={() => jumpTo(p.firstBelowBuffer!)}>
                Below buffer from {formatShort(p.firstBelowBuffer, thisYear)}
              </Chip>
            {/if}
            {#if p.firstBelowZero}
              <Chip tone="coral" icon="down" title="First day under zero. Show this day." onclick={() => jumpTo(p.firstBelowZero!)}>
                Below ₱0 from {formatShort(p.firstBelowZero, thisYear)}
              </Chip>
            {/if}
            {#if p.whatIfDays}
              <span class="legend"><i class="swatch"></i>Dashed: with what-ifs</span>
            {/if}
          </div>
          <p class="sr-only">Chips jump the timeline to that day. In the Date slider, Page Up and Page Down move one cutoff.</p>
        {/if}
      </div>

      {#if p}
        <div class="land">
          <Chart
            projection={p}
            bufferCentavos={buffer}
            todayIndex={rawToday}
            bind:selected={app.selectedDay}
            onscrub={stopPlay}
            padTop={28}
            padBottom={wide ? 132 : 36}
            padRight={wide ? 424 : 0}
          />
        </div>
        <div class="timebar">
          <TimeBar
            projection={p}
            bind:selected={app.selectedDay}
            {playing}
            ontoggleplay={togglePlay}
            onscrub={stopPlay}
            horizonMonths={s.horizonMonths}
            onhorizon={setHorizon}
          />
        </div>
      {/if}
    </section>

    {#if p && cutoff}
      <aside class="panel" aria-label="Selected cutoff">
        <section class="cutoff" aria-labelledby="cut-h">
          <div class="cut-head">
            <h2 id="cut-h">
              {cutoff.payday <= app.today && app.today <= cutoff.end ? 'This cutoff' : 'Cutoff'} · {formatDayRange(cutoff.payday, cutoff.end)}
            </h2>
            <div class="steps">
              <button type="button" class="step" aria-label="Previous cutoff" disabled={cutIdx === 0} onclick={() => stepCutoff(-1)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7l7 7" /></svg>
              </button>
              <button type="button" class="step" aria-label="Next cutoff" disabled={isLastCutoff} onclick={() => stepCutoff(1)}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7l-7 7" /></svg>
              </button>
            </div>
          </div>
          <p class="flow">
            In <b class="pos">+{formatPeso(cutoff.incomeCentavos)}</b> · Out <b>{formatPeso(-cutoff.outflowCentavos)}</b>
          </p>
          {#if movedNote}<p class="moved">{movedNote}</p>{/if}

          {#if cutEvents.length > 0}
            <ul class="events">
              {#each cutEvents as e, k (k)}
                <li class:whatif={!e.included} class:on={eventDay(e) === sel} class:past={eventDay(e) < sel}>
                  <span class="d">{formatShort(e.date)}</span>
                  <span class="what">
                    <span class="name">{e.name}</span>
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

          <p class="left">
            <span>{isLastCutoff ? `Left on ${formatShort(cutoff.end, thisYear)}` : `Left before ${formatShort(addDays(cutoff.end, 1), thisYear)}`}</span>
            <b class:low={cutoff.leftCentavos < buffer}>{formatPeso(cutoff.leftCentavos)}</b>
          </p>
        </section>

        <section class="coming" aria-labelledby="up-h">
          <h2 id="up-h">Coming up</h2>
          {#if upcoming.length > 0}
            <ul class="events">
              {#each upcoming as u, k (k)}
                <li>
                  <span class="d">{formatCompact(u.date, thisYear)}</span>
                  <span class="what"><span class="name">{u.label}</span></span>
                  <span class="amt" class:pos={u.tone !== 'neg'}>{u.amount}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="quiet">Nothing big after this cutoff.</p>
          {/if}
        </section>
      </aside>
    {/if}
  </div>
{/if}

<style>
  /* ---------- shared bits ---------- */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 10px 18px;
    border-radius: 99px;
    border: 1px solid transparent;
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 800;
    text-decoration: none;
    cursor: pointer;
    transition:
      transform 120ms ease-out,
      background-color 160ms ease-out;
  }
  .btn.small {
    min-height: 36px;
    padding: 6px 14px;
    font-size: 0.875rem;
  }
  .btn:active {
    transform: scale(0.97);
  }
  .btn.primary {
    background: var(--mango);
    color: var(--on-mango);
  }
  .btn.primary:hover {
    background: color-mix(in srgb, var(--mango) 88%, var(--text));
  }
  .btn.ghost {
    background: transparent;
    border-color: var(--glass-line);
    color: var(--text);
  }
  .btn.ghost:hover {
    background: var(--glass-hover);
  }
  .btn:disabled {
    cursor: progress;
  }
  .pos {
    color: var(--teal-text);
  }
  .low {
    color: var(--coral-text);
  }

  /* ---------- the scene ---------- */
  .tl {
    position: relative;
  }
  .scene {
    position: relative;
    display: flex;
    flex-direction: column;
    isolation: isolate;
  }
  .scene :global(.range) {
    z-index: -1;
    top: 18%;
    height: 82%;
  }
  .readout {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 0 16px;
    min-width: 0;
  }
  .land {
    position: relative;
    height: 240px;
    margin-top: 4px;
  }
  .timebar {
    position: relative;
    z-index: 2;
    margin: 6px 12px 0;
  }

  /* ---------- readout ---------- */
  .when {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 500;
    color: var(--muted);
  }
  .when b {
    color: var(--text);
    font-weight: 700;
  }
  .big {
    margin: 2px 0 6px;
    font-size: clamp(3.25rem, 14vw, 4.5rem);
    font-weight: 230;
    letter-spacing: -0.04em;
    line-height: 1;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .big .cur {
    margin-right: 0.04em;
    font-size: 0.6em;
    font-weight: 300;
    color: var(--muted);
    vertical-align: 0.42em;
  }
  .big .cents {
    margin-left: 0.04em;
    font-size: 0.42em;
    font-weight: 400;
    letter-spacing: -0.02em;
    color: var(--muted-2);
    vertical-align: 0.95em;
  }
  .big.low,
  .big.low .cur {
    color: var(--coral-text);
  }
  .story {
    margin: 0;
    max-width: 46ch;
    font-size: 1rem;
    line-height: 1.55;
    color: var(--muted);
    text-wrap: pretty;
  }
  .story strong {
    color: var(--text);
    font-weight: 700;
  }
  .amt-inline {
    color: var(--text);
    font-weight: 700;
    white-space: nowrap;
  }
  .amt-inline.pos {
    color: var(--teal-text);
  }
  .chips {
    display: flex;
    gap: 8px;
    margin: 0 -16px;
    padding: 0 16px 2px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .chips > :global(*) {
    flex: none;
  }
  .moved-inline {
    color: var(--text);
    font-weight: 600;
  }
  .legend {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 0 6px;
    font-size: 0.875rem;
    color: var(--muted);
  }
  .swatch {
    display: inline-block;
    width: 22px;
    border-top: 2px dashed var(--muted);
  }

  /* ---------- banners ---------- */
  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 8px 14px;
    padding: 10px 10px 10px 16px;
    border-radius: 18px;
    background: var(--glass-solid);
    border: 1px solid var(--glass-line);
  }
  .banner p {
    margin: 0;
    flex: 1 1 220px;
    font-size: 0.9375rem;
    color: var(--muted);
  }
  .banner strong {
    color: var(--text);
  }
  .banner.sample {
    align-self: flex-start;
    flex-wrap: nowrap;
    padding: 4px 4px 4px 16px;
    border-radius: 99px;
  }
  .banner.sample p {
    flex: 0 1 auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .banner-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .field-error {
    margin: 4px 0 0 !important;
    color: var(--coral-text) !important;
    font-weight: 600;
    font-size: 0.875rem;
  }

  /* ---------- the floating cutoff panel ---------- */
  .panel {
    display: flex;
    flex-direction: column;
    gap: 22px;
    margin: 16px 12px 0;
    padding: 18px 16px;
    border-radius: 22px;
    background: var(--glass-solid);
    border: 1px solid var(--glass-line);
  }
  .panel h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 750;
    letter-spacing: -0.01em;
  }
  .cut-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .steps {
    display: flex;
    gap: 2px;
    margin: -6px -6px -6px 0;
  }
  .step {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 99px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }
  .step:hover:not(:disabled) {
    background: var(--glass-hover);
  }
  .step:disabled {
    color: var(--muted-2);
    cursor: default;
  }
  .step svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .flow {
    margin: 6px 0 0;
    font-size: 0.875rem;
    color: var(--muted);
  }
  .flow b {
    font-weight: 700;
    color: var(--text);
  }
  .flow b.pos {
    color: var(--teal-text);
  }
  .moved {
    margin: 6px 0 0;
    font-size: 0.875rem;
    color: var(--muted);
  }

  .events {
    list-style: none;
    margin: 10px -10px 0;
    padding: 0;
  }
  .events li {
    display: grid;
    grid-template-columns: 3.75rem minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 10px;
    padding: 9px 10px;
    border-radius: 12px;
    font-size: 0.9375rem;
    transition:
      background-color 250ms var(--ease-out),
      opacity 250ms var(--ease-out);
  }
  .coming .events li {
    grid-template-columns: 5.25rem minmax(0, 1fr) auto;
  }
  .events li.on {
    background: color-mix(in srgb, var(--mango) 14%, transparent);
  }
  .events li.on .d {
    color: var(--mango-text);
  }
  .events li.past {
    opacity: 0.55;
  }
  .d {
    color: var(--muted-2);
    font-size: 0.875rem;
    font-weight: 700;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .what {
    min-width: 0;
  }
  .name {
    display: block;
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  .sub {
    display: block;
    margin-top: 1px;
    font-size: 0.875rem;
    color: var(--muted-2);
  }
  .whatif .name,
  .whatif .amt {
    color: var(--muted);
  }
  .whatif .amt {
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }
  .amt {
    font-weight: 700;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .quiet {
    margin: 10px 0 0;
    color: var(--muted);
    font-size: 0.9375rem;
  }
  .left {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    margin: 10px 0 0;
    padding-top: 12px;
    border-top: 1px solid var(--glass-line);
    font-weight: 700;
  }
  .left b {
    font-size: 1.125rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .coming h2 {
    font-size: 0.9375rem;
  }

  /* ---------- tablets: more room for the land ---------- */
  @media (min-width: 640px) {
    .readout {
      padding: 8px 24px 0;
    }
    .land {
      height: 340px;
    }
    .chips {
      flex-wrap: wrap;
      margin: 0;
      padding: 0;
      overflow: visible;
    }
    .timebar {
      margin: 6px 20px 0;
    }
    .panel {
      margin: 18px 20px 0;
    }
  }

  /* ---------- 1024px and wider: the full view ---------- */
  @media (min-width: 1024px) {
    .tl {
      height: calc(100dvh - var(--topbar));
      min-height: 660px;
    }
    .scene {
      position: absolute;
      inset: 0;
    }
    .readout {
      padding: 12px 48px 0;
      max-width: calc(100% - 420px);
    }
    .big {
      font-size: clamp(4.5rem, 6.6vw, 6.5rem);
      margin: 6px 0 12px;
    }
    .story {
      font-size: 1.0625rem;
    }
    .land {
      flex: 1;
      height: auto;
      min-height: 240px;
      margin-top: 0;
    }
    .timebar {
      position: absolute;
      left: 32px;
      right: 32px;
      bottom: 24px;
      margin: 0;
    }
    .panel {
      position: absolute;
      z-index: 3;
      top: 8px;
      right: 32px;
      bottom: 112px;
      width: 368px;
      margin: 0;
      padding: 18px 16px;
      overflow-y: auto;
      overscroll-behavior: contain;
      background: var(--glass);
      box-shadow: var(--shadow-float);
      scrollbar-width: thin;
    }
    .panel:not(:has(.events li:nth-child(6))) {
      bottom: auto;
      max-height: calc(100% - 120px);
    }
  }
  @media (min-width: 1024px) and (prefers-reduced-transparency: no-preference) {
    .panel {
      backdrop-filter: blur(22px) saturate(1.15);
      -webkit-backdrop-filter: blur(22px) saturate(1.15);
    }
  }
  @media (min-width: 1440px) {
    .readout {
      padding-left: 56px;
    }
  }

  /* ---------- empty, loading, error ---------- */
  .empty {
    display: grid;
    justify-items: center;
    gap: 12px;
    max-width: 30rem;
    margin: 0 auto;
    padding: 64px 20px 32px;
    text-align: center;
  }
  .empty h2 {
    margin: 8px 0 0;
    font-size: 1.5rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.25;
    text-wrap: balance;
  }
  .empty p {
    margin: 0 0 8px;
    color: var(--muted);
    text-wrap: pretty;
  }
  .mark {
    width: min(240px, 70vw);
    height: auto;
  }
  .mark-fill {
    fill: var(--teal);
    fill-opacity: 0.16;
  }
  .mark-line {
    fill: none;
    stroke: var(--teal);
    stroke-width: 3;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .mark-dot {
    fill: var(--mango);
    stroke: var(--bg);
    stroke-width: 3;
  }

  .loading {
    padding: 24px 16px;
    color: var(--muted);
  }
  .loading p {
    margin: 0 0 14px;
  }
  .skeleton {
    height: 220px;
    border-radius: 22px;
    background: linear-gradient(100deg, var(--glass) 30%, var(--glass-solid) 50%, var(--glass) 70%) 0 0 / 300% 100%;
    animation: shimmer 1.4s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -150% 0;
    }
  }
  .notice {
    max-width: 32rem;
    margin: 32px 16px;
    padding: 18px;
    border-radius: 18px;
    background: color-mix(in srgb, var(--coral) 9%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--coral) 45%, transparent);
  }
  .notice h2 {
    margin: 0 0 6px;
    font-size: 1.125rem;
  }
  .notice p {
    margin: 0;
  }
</style>
