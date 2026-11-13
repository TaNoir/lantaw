<script lang="ts">
  import Chart from '../components/Chart.svelte';
  import Chip from '../components/Chip.svelte';
  import { app } from '../lib/state.svelte';
  import type { EngineEvent } from '../lib/engine-types';
  import { isBalanceStale } from '../lib/input';
  import { nextCutoffIndex } from '../lib/chart';
  import { movedReason } from '../lib/cutoff';
  import { formatPeso, parseRate, toCentavos } from '../lib/money';
  import {
    addDays,
    daysBetween,
    formatCompact,
    formatDate,
    formatDayRange,
    formatMonthYear,
    formatShort,
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
    if (delta === 0) return isToday ? 'Drag the timeline to look ahead' : `Same as ${refLabel}`;
    return `${delta > 0 ? '+' : ''}${formatPeso(delta)} vs ${refLabel}`;
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

  // ---- chips ----
  const gipitIdx = $derived(p?.gipit ? daysBetween(p.start, p.gipit.date) : -1);
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

  let rateRaw = $state('');
  let rateError = $state('');
  let savingRate = $state(false);

  async function submitRate(e: SubmitEvent) {
    e.preventDefault();
    const cur = app.missingRate;
    if (!cur) return;
    const r = parseRate(rateRaw);
    if (!r.ok) {
      rateError = r.error;
      return;
    }
    rateError = '';
    savingRate = true;
    try {
      await app.saveManualRate(cur, r.value);
      rateRaw = '';
    } finally {
      savingRate = false;
    }
  }

  // ---- helpers ----
  function signed(c: number): string {
    return c > 0 ? `+${formatPeso(c)}` : formatPeso(c);
  }

  function jumpTo(date: string) {
    if (!p) return;
    app.selectedDay = Math.min(Math.max(daysBetween(p.start, date), 0), n - 1);
  }

  function stepCutoff(dir: 1 | -1) {
    if (!p) return;
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
    <svg class="ridge" viewBox="0 0 240 90" aria-hidden="true">
      <path class="ridge-fill" d="M0 70 L40 52 L64 58 L104 22 L120 30 L150 46 L184 38 L240 50 L240 90 L0 90 Z" />
      <path class="ridge-line" d="M0 70 L40 52 L64 58 L104 22 L120 30 L150 46 L184 38 L240 50" />
      <circle class="ridge-dot" cx="104" cy="22" r="6" />
    </svg>
    <h2>Add your sweldo and bills to see your forecast</h2>
    <p>Lantaw draws your balance day by day for the next {s.horizonMonths} months, so you can see a gipit day coming. Nothing leaves your device.</p>
    <a class="btn primary" href="#/items">Add items</a>
  </section>
{:else}
  <div class="timeline">
    <div class="main-col">
      {#if s.isSample}
        <section class="banner sample" aria-labelledby="sample-h">
          <p>
            <strong id="sample-h">Sample budget</strong> · A made-up Davao budget to play with. Clear it when you’re
            ready to add your own.
          </p>
          <button
            type="button"
            class="btn ghost"
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
        </section>
      {/if}

      {#if app.missingRate}
        <section class="banner warn" aria-labelledby="fx-h">
          <h2 id="fx-h" class="banner-title">Lantaw needs a {app.missingRate} rate</h2>
          <p>There’s no saved {app.missingRate} to peso rate yet, and Lantaw couldn’t get one online. Type today’s rate to update your forecast.</p>
          <form class="rate" onsubmit={submitRate} novalidate>
            <label for="fx-rate">₱ per 1 {app.missingRate}</label>
            <div class="rate-row">
              <input
                id="fx-rate"
                inputmode="decimal"
                autocomplete="off"
                placeholder="e.g. 58.25"
                bind:value={rateRaw}
                aria-invalid={rateError ? 'true' : undefined}
                aria-describedby={rateError ? 'fx-err' : undefined}
              />
              <button class="btn primary" type="submit" disabled={savingRate}>Save rate</button>
            </div>
            {#if rateError}<p id="fx-err" class="field-error">{rateError}</p>{/if}
          </form>
        </section>
      {/if}

      {#if app.error}
        <section class="banner danger" role="alert">
          <h2 class="banner-title">Lantaw couldn’t update your forecast</h2>
          <p>{app.error.detail}</p>
          <a class="btn ghost" href="#/items">Check your items</a>
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
          <a class="btn ghost" href="#/settings">Update</a>
        </section>
      {/if}

      {#if p}
        <header class="head">
          <div class="readout">
            <p class="kicker">
              {isToday ? `Balance today · ${formatShort(selDate, thisYear)}` : `Balance on ${formatDate(selDate)}`}
            </p>
            <p class="big" class:low={balance < buffer} data-testid="balance">{formatPeso(balance)}</p>
            <p class="delta">{deltaText}</p>
          </div>
          <div class="horizon" role="group" aria-label="Look ahead">
            <button type="button" aria-pressed={s.horizonMonths === 12} onclick={() => setHorizon(12)}>12 mo</button>
            <button type="button" aria-pressed={s.horizonMonths === 24} onclick={() => setHorizon(24)}>24 mo</button>
          </div>
        </header>

        <Chart projection={p} bufferCentavos={buffer} todayIndex={rawToday} bind:selected={app.selectedDay} />

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
        </div>
        <p class="sr-only">Chips jump the timeline to that day. In the Date slider, Page Up and Page Down move one cutoff.</p>
      {/if}
    </div>

    {#if p && cutoff}
      <aside class="side" aria-label="Selected cutoff">
        <section class="cutoff" aria-labelledby="cut-h">
          <div class="cut-head">
            <h2 id="cut-h" class="kicker">
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
          {#if movedNote}<p class="moved">{movedNote}</p>{/if}

          {#if cutEvents.length > 0}
            <ul class="events">
              {#each cutEvents as e, k (k)}
                <li class:whatif={!e.included} class:on={eventDay(e) === sel}>
                  <span class="when">{formatShort(e.date)}</span>
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

          <dl class="totals">
            <div><dt>In</dt><dd class="pos">+{formatPeso(cutoff.incomeCentavos)}</dd></div>
            <div><dt>Out</dt><dd>{formatPeso(-cutoff.outflowCentavos)}</dd></div>
            <div class="left">
              <dt>{isLastCutoff ? `Left on ${formatShort(cutoff.end, thisYear)}` : `Left before ${formatShort(addDays(cutoff.end, 1), thisYear)}`}</dt>
              <dd class:low={cutoff.leftCentavos < buffer}>{formatPeso(cutoff.leftCentavos)}</dd>
            </div>
          </dl>
        </section>

        <section class="coming" aria-labelledby="up-h">
          <h2 id="up-h" class="kicker">Coming up</h2>
          {#if upcoming.length > 0}
            <ul class="events">
              {#each upcoming as u, k (k)}
                <li>
                  <span class="when">{formatCompact(u.date, thisYear)}</span>
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
  .kicker {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--muted);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 10px 18px;
    border-radius: 12px;
    border: 1.5px solid transparent;
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 800;
    text-decoration: none;
    cursor: pointer;
    transition:
      transform 120ms ease-out,
      background-color 160ms ease-out;
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
  .btn.primary:disabled {
    cursor: progress;
  }
  .btn.ghost {
    background: transparent;
    border-color: var(--border);
    color: var(--text);
  }
  .btn.ghost:hover {
    background: var(--surface-2);
  }
  .pos {
    color: var(--teal-text);
  }
  .low {
    color: var(--coral-text);
  }

  /* ---------- layout ---------- */
  .timeline {
    display: grid;
    gap: 20px;
    padding: 4px 16px 24px;
  }
  .main-col {
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  @media (min-width: 1024px) {
    .timeline {
      grid-template-columns: minmax(0, 1fr) clamp(300px, 28vw, 360px);
      gap: 0;
      padding: 0;
      min-height: 100dvh;
    }
    .main-col {
      padding: 28px 32px 32px;
      gap: 16px;
    }
    .side {
      position: sticky;
      top: 0;
      max-height: 100dvh;
      overflow-y: auto;
      padding: 28px 22px;
      background: var(--surface);
      border-left: 1px solid var(--border);
    }
  }

  /* ---------- header ---------- */
  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }
  .readout {
    min-width: 0;
  }
  .big {
    margin: 2px 0 0;
    font-size: clamp(2.25rem, 9vw, 3rem);
    font-weight: 800;
    letter-spacing: -0.035em;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
  }
  .delta {
    margin: 4px 0 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .horizon {
    display: inline-flex;
    flex: none;
    padding: 3px;
    border-radius: 12px;
    background: var(--surface-2);
  }
  .horizon button {
    min-height: 38px;
    min-width: 58px;
    padding: 6px 10px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 700;
    cursor: pointer;
    transition:
      background-color 160ms ease-out,
      color 160ms ease-out;
  }
  .horizon button:hover {
    color: var(--text);
  }
  .horizon button[aria-pressed='true'] {
    background: var(--bg);
    color: var(--teal-text);
    box-shadow: 0 1px 0 var(--border);
  }
  @media (min-width: 1024px) {
    .big {
      font-size: 3.25rem;
    }
  }

  /* ---------- chips ---------- */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  /* ---------- banners ---------- */
  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 16px;
    padding: 14px 16px;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--mango) 9%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--mango) 45%, transparent);
  }
  .banner p {
    margin: 0;
    flex: 1 1 220px;
    font-size: 0.9375rem;
  }
  .banner.warn {
    display: block;
  }
  .banner.warn p {
    margin: 4px 0 12px;
  }
  .banner.sample {
    background: color-mix(in srgb, var(--teal) 10%, var(--surface));
    border-color: color-mix(in srgb, var(--teal) 45%, transparent);
  }
  .banner.sample .btn:disabled {
    cursor: progress;
  }
  .banner.danger {
    background: color-mix(in srgb, var(--coral) 9%, var(--surface));
    border-color: color-mix(in srgb, var(--coral) 45%, transparent);
  }
  .banner-title {
    margin: 0;
    flex-basis: 100%;
    font-size: 1rem;
    font-weight: 800;
  }
  .rate label {
    display: block;
    margin-bottom: 6px;
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--muted);
  }
  .rate-row {
    display: flex;
    gap: 8px;
  }
  .rate input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    padding: 8px 12px;
    border-radius: 12px;
    border: 1.5px solid var(--border);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 1.125rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .rate input:focus-visible {
    border-color: var(--teal);
  }
  .rate input[aria-invalid='true'] {
    border-color: var(--coral);
  }
  .field-error {
    margin: 8px 0 0 !important;
    color: var(--coral-text);
    font-weight: 600;
    font-size: 0.875rem;
  }

  /* ---------- side panel: cutoff + coming up ---------- */
  .side {
    display: flex;
    flex-direction: column;
    gap: 22px;
    min-width: 0;
  }
  .cutoff,
  .coming {
    min-width: 0;
  }
  @media (max-width: 1023.98px) {
    .side {
      padding: 0;
    }
    .cutoff {
      padding: 16px;
      border-radius: 16px;
      background: var(--surface);
      border: 1px solid var(--border);
    }
  }
  .cut-head {
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
    width: 40px;
    height: 40px;
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
  .moved {
    margin: 6px 0 0;
    font-size: 0.875rem;
    color: var(--muted);
  }

  .events {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
  }
  .events li {
    display: grid;
    grid-template-columns: 4.6rem minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.9375rem;
  }
  .coming .events li {
    grid-template-columns: 5.75rem minmax(0, 1fr) auto;
  }
  .events li:last-child {
    border-bottom: 0;
  }
  .events li.on {
    margin: 0 -10px;
    padding: 10px;
    border-radius: 10px;
    border-bottom-color: transparent;
    background: color-mix(in srgb, var(--mango) 13%, transparent);
  }
  .events li.on .when {
    color: var(--text);
  }
  .events li.on .when::before {
    content: '';
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--mango);
    vertical-align: 0.1em;
  }
  .when {
    color: var(--muted);
    font-size: 0.875rem;
    font-weight: 600;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .what {
    min-width: 0;
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
  .whatif .name,
  .whatif .amt {
    font-style: italic;
  }
  .whatif .amt {
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-thickness: 1px;
  }
  .amt {
    font-weight: 800;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .quiet {
    margin: 10px 0 0;
    color: var(--muted);
    font-size: 0.9375rem;
  }

  .totals {
    margin: 10px 0 0;
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
  .totals .left {
    margin-top: 6px;
    padding-top: 8px;
    border-top: 1px dashed var(--border);
  }
  .totals .left dt {
    color: var(--text);
    font-weight: 800;
  }
  .totals .left dd {
    font-size: 1.125rem;
    font-weight: 800;
  }

  /* ---------- empty, loading, error ---------- */
  .empty {
    display: grid;
    justify-items: center;
    gap: 12px;
    max-width: 30rem;
    margin: 0 auto;
    padding: 48px 20px 32px;
    text-align: center;
  }
  .empty h2 {
    margin: 8px 0 0;
    font-size: 1.375rem;
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
  .ridge {
    width: min(240px, 70vw);
    height: auto;
  }
  .ridge-fill {
    fill: var(--teal);
    fill-opacity: 0.16;
  }
  .ridge-line {
    fill: none;
    stroke: var(--teal);
    stroke-width: 3;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .ridge-dot {
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
    border-radius: 16px;
    background: linear-gradient(100deg, var(--surface) 30%, var(--surface-2) 50%, var(--surface) 70%) 0 0 / 300% 100%;
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
    border-radius: 16px;
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
