<script lang="ts" module>
  import type { KayaForm } from '../lib/kaya';

  // Kept in memory while switching tabs (never saved): a trip to the Timeline
  // and back keeps what was typed. A reload starts fresh.
  const form = $state<KayaForm>({ name: '', price: '', date: '', rows: [] });
  let rowSeq = 0;
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte';
  import ScreenGate from '../components/ScreenGate.svelte';
  import VerdictCard from '../components/VerdictCard.svelte';
  import AddToPlan from '../components/AddToPlan.svelte';
  import { app } from '../lib/state.svelte';
  import { EngineError, comparePurchase } from '../lib/engine';
  import type { Comparison, PayOption, Purchase } from '../lib/engine-types';
  import {
    MONTHS_MAX,
    bestReason,
    buildPurchase,
    dateWindow,
    optionKey,
    optionTitle,
    planDraft,
    verdictLabel,
  } from '../lib/kaya';
  import { NAME_MAX, itemsToSave, shiftMonths, validateItem } from '../lib/items';
  import { formatPeso, toCentavos } from '../lib/money';
  import { formatDate, formatShort, yearOf } from '../lib/dates';

  // A date left from an earlier day moves up to today.
  if (form.date === '' || form.date < app.today) form.date = app.today;

  const win = $derived(app.projection ? dateWindow(app.projection, app.today, app.settings.horizonMonths) : null);
  const check = $derived(win ? buildPurchase(form, win) : null);
  const buffer = $derived(toCentavos(app.settings.safetyBuffer));
  const refYear = $derived(yearOf(app.today));
  /** Coming back after the forecast ran out: no date can be picked until the balance is updated. */
  const forecastOver = $derived(!!win && win.first > win.last);

  // ---- live comparison (debounced; never throws to the UI) ----
  type Shown = { purchase: Purchase; comparison: Comparison; key: string };
  let shown = $state.raw<Shown | null>(null);
  let problem = $state<string | null>(null);
  /** After "Add to plan", keep these results until the form changes (the new item would otherwise count twice). */
  let hold: string | null = null;

  $effect(() => {
    const purchase = check?.purchase ?? null;
    void app.projection; // compare again whenever the forecast changes
    if (!purchase) {
      shown = null;
      problem = null;
      hold = null;
      return;
    }
    const key = JSON.stringify(purchase);
    if (hold === key) return;
    hold = null;
    const t = setTimeout(() => compare(purchase, key), untrack(() => shown) ? 150 : 0);
    return () => clearTimeout(t);
  });

  function compare(purchase: Purchase, key: string) {
    const input = app.currentInput();
    if (!input) {
      shown = null;
      problem = app.missingRate ? null : 'Lantaw is still loading your forecast.';
      return;
    }
    try {
      shown = { purchase, comparison: comparePurchase(input, purchase), key };
      problem = null;
    } catch (e) {
      const err = e instanceof EngineError ? e : EngineError.parse(e);
      shown = null;
      if (err.code === 'MISSING_FX') problem = null;
      else if (err.code === 'INVALID_ITEM' && /horizon/.test(err.detail)) {
        problem = `Pick a date within your ${app.settings.horizonMonths}-month forecast.`;
      } else problem = 'Lantaw couldn’t compare these options. Check the price and the months, then try again.';
    }
  }

  const summary = $derived.by(() => {
    if (!shown) return '';
    const { comparison: c, purchase } = shown;
    const parts = c.options.map((r) => `${optionTitle(r, purchase.date, app.today)}: ${verdictLabel(r.verdict)}`);
    const best = c.bestCashDate
      ? `Best date to pay cash: ${formatShort(c.bestCashDate.date, refYear)}.`
      : `No cash date within the next ${app.settings.horizonMonths} months.`;
    return `${best} ${parts.join('. ')}.`;
  });

  // ---- installment rows ----
  let addRowBtn: HTMLButtonElement | undefined = $state();

  async function addRow() {
    const id = ++rowSeq;
    form.rows.push({ id, months: form.rows.length === 0 ? '6' : '12', monthly: '' });
    await tick();
    (document.getElementById(`kb-m-${id}`) as HTMLInputElement | null)?.select();
  }

  async function removeRow(id: number) {
    const i = form.rows.findIndex((r) => r.id === id);
    if (i >= 0) form.rows.splice(i, 1);
    await tick();
    addRowBtn?.focus();
  }

  // ---- add to plan ----
  let nameEl: HTMLInputElement | undefined = $state();
  let nameMissing = $state(false);
  $effect(() => {
    if (form.name.trim() !== '') nameMissing = false;
  });

  async function add(option: PayOption, date: string, monthlyCentavos: number | null, included: boolean) {
    const s = shown;
    if (!s) return 'Lantaw is still comparing. Try again in a moment.';
    const v = validateItem(
      planDraft({
        name: form.name,
        price: s.purchase.price,
        date,
        option,
        monthlyCentavos,
        included,
        existingIds: app.items.map((i) => i.id),
      }),
    );
    if (!v.ok) {
      if (v.errors.name) {
        nameMissing = true;
        nameEl?.focus();
        return 'Give it a name first, in “What are you buying?”.';
      }
      return Object.values(v.errors)[0] ?? 'Lantaw couldn’t make an item from this option.';
    }
    hold = s.key;
    try {
      await app.saveItems(itemsToSave(app.items, v.item));
    } catch (e) {
      hold = null;
      throw e;
    }
    return null;
  }
</script>

<ScreenGate
  emptyTitle="Add your sweldo and bills first"
  emptyBody="Kaya ba? checks a purchase against your forecast, so it needs your pay and the bills it covers. Nothing leaves your device."
>
  {#if win && check}
    <div class="page">
      <header class="top">
        <h1>Kaya ba?</h1>
        <p class="lede">Can you afford it? See what each way of paying does to your balance.</p>
      </header>

      <div class="layout">
        <form class="card form" novalidate onsubmit={(e) => e.preventDefault()} aria-label="What you want to buy">
          <div class="field">
            <label for="kb-name">What are you buying?</label>
            <input
              id="kb-name"
              type="text"
              bind:this={nameEl}
              bind:value={form.name}
              maxlength={NAME_MAX}
              autocomplete="off"
              enterkeyhint="next"
              placeholder="e.g. Inverter aircon"
              aria-invalid={nameMissing}
              aria-describedby={nameMissing ? 'kb-name-err' : undefined}
            />
            {#if nameMissing}
              <p class="err" id="kb-name-err">Give it a name to add it to your plan.</p>
            {/if}
          </div>

          <div class="field">
            <label for="kb-price">Cash price</label>
            <div class="money-in big" class:bad={!!check.errors.price}>
              <span class="sym" aria-hidden="true">₱</span>
              <input
                id="kb-price"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                enterkeyhint="done"
                placeholder="e.g. 28,990"
                bind:value={form.price}
                aria-invalid={!!check.errors.price}
                aria-describedby={check.errors.price ? 'kb-price-err' : undefined}
              />
            </div>
            {#if check.errors.price}<p class="err" id="kb-price-err">{check.errors.price}</p>{/if}
          </div>

          <div class="field">
            <label for="kb-date">When would you buy it?</label>
            <input
              id="kb-date"
              type="date"
              bind:value={form.date}
              min={win.first}
              max={win.last}
              aria-invalid={!!check.errors.date}
              aria-describedby={check.errors.date ? 'kb-date-hint kb-date-err' : 'kb-date-hint'}
            />
            <p class="hint" id="kb-date-hint">Today, or any day until {formatDate(win.last)}.</p>
            {#if check.errors.date}<p class="err" id="kb-date-err">{check.errors.date}</p>{/if}
          </div>

          <fieldset class="ways">
            <legend>Ways to pay</legend>
            <div class="cash-row">
              <span class="cash-name">Cash</span>
              <span class="hint inline">Always compared</span>
            </div>

            {#each form.rows as row, n (row.id)}
              {@const e = check.errors.rows[row.id] ?? {}}
              <div class="row" role="group" aria-labelledby="kb-r-{row.id}">
                <div class="row-head">
                  <span class="row-title" id="kb-r-{row.id}">Installment {n + 1}</span>
                  <button
                    type="button"
                    class="remove"
                    aria-label="Remove installment {n + 1}"
                    onclick={() => removeRow(row.id)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12 M18 6L6 18" /></svg>
                    Remove
                  </button>
                </div>
                <div class="pair">
                  <div class="field">
                    <label for="kb-m-{row.id}">Months</label>
                    <input
                      id="kb-m-{row.id}"
                      type="text"
                      inputmode="numeric"
                      autocomplete="off"
                      maxlength="3"
                      bind:value={row.months}
                      aria-invalid={!!e.months}
                      aria-describedby={e.months ? `kb-m-${row.id}-err` : undefined}
                    />
                  </div>
                  <div class="field">
                    <label for="kb-x-{row.id}">Monthly <span class="opt">(optional)</span></label>
                    <div class="money-in" class:bad={!!e.monthly}>
                      <span class="sym" aria-hidden="true">₱</span>
                      <input
                        id="kb-x-{row.id}"
                        type="text"
                        inputmode="decimal"
                        autocomplete="off"
                        placeholder="0%"
                        bind:value={row.monthly}
                        aria-invalid={!!e.monthly}
                        aria-describedby={e.monthly ? `kb-x-${row.id}-err kb-0-hint` : 'kb-0-hint'}
                      />
                    </div>
                  </div>
                </div>
                {#if e.months}<p class="err" id="kb-m-{row.id}-err">{e.months}</p>{/if}
                {#if e.monthly}<p class="err" id="kb-x-{row.id}-err">{e.monthly}</p>{/if}
              </div>
            {/each}

            {#if form.rows.length > 0}
              <p class="hint" id="kb-0-hint">
                Leave the monthly blank for 0%: the price split evenly. Months go from 1 to {MONTHS_MAX}.
              </p>
            {/if}
            <button
              type="button"
              class="add-row"
              bind:this={addRowBtn}
              aria-label="Add an installment"
              onclick={addRow}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14 M5 12h14" /></svg>
              Installment
            </button>
          </fieldset>
        </form>

        <section class="results" aria-labelledby="kb-results-h">
          <h2 id="kb-results-h" class="sr-only">Results</h2>

          {#if forecastOver}
            <div class="card notice">
              <h3>Your forecast has run out</h3>
              <p>It ended on {formatDate(win.last)}. Update your balance and Lantaw can check purchases again.</p>
              <a class="link" href="#/settings">Update your balance</a>
            </div>
          {:else if app.missingRate}
            <div class="card notice">
              <h3>Lantaw needs a {app.missingRate} rate</h3>
              <p>One of your items is in {app.missingRate}, and there’s no saved rate yet. Add it on the Timeline, then come back.</p>
              <a class="link" href="#/timeline">Go to Timeline</a>
            </div>
          {:else if check.empty}
            <div class="card intro">
              <h3>Type the price to check</h3>
              <p>Lantaw tries each way of paying against your forecast and tags it:</p>
              <ul class="legend">
                <li><span class="tag kaya">Kaya</span> you never go below your {formatPeso(buffer)} buffer</li>
                <li><span class="tag gipit">Gipit</span> you dip below the buffer for a while</li>
                <li><span class="tag hindiKaya">Hindi kaya</span> more than 30 days below ₱0</li>
              </ul>
            </div>
          {:else if !check.purchase}
            <div class="card intro">
              <p>Fix the {check.errors.price ? 'price' : 'date'} to see the results.</p>
            </div>
          {:else if problem}
            <div class="card intro"><p>{problem}</p></div>
          {:else if shown}
            {@const s = shown}
            {@const c = s.comparison}
            <div class="summary">
              <p class="s-name">{form.name.trim() || 'This purchase'}</p>
              <p class="s-price">{formatPeso(toCentavos(s.purchase.price))}</p>
              {#if s.purchase.date !== app.today}
                <p class="s-date">on {formatShort(s.purchase.date, refYear)}</p>
              {/if}
            </div>

            {#if c.bestCashDate}
              {@const b = c.bestCashDate}
              {@const when = formatShort(b.date, refYear)}
              <article class="bestcard" aria-labelledby="kb-best-h">
                <header class="b-head">
                  <h3 id="kb-best-h"><span class="spark" aria-hidden="true">✦</span>Cash on {when}</h3>
                  <span class="tag kaya">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3l6-7" /></svg>
                    Kaya
                  </span>
                </header>
                <p class="reason">{bestReason(b.reason, buffer)}</p>
                <div class="ln">
                  <span class="dt">Lowest after buying</span>
                  <span class="dd">{formatPeso(b.lowestAfter.centavos)} · {formatShort(b.lowestAfter.date, refYear)}</span>
                </div>
                <AddToPlan
                  what="cash on {when}"
                  resetKey={s.key}
                  onadd={(inc) => add({ type: 'cash' }, b.date, null, inc)}
                />
              </article>
            {:else}
              <article class="card nobest" aria-labelledby="kb-nobest-h">
                <h3 id="kb-nobest-h">Not within the next {app.settings.horizonMonths} months.</h3>
                <p>
                  Paying {formatPeso(toCentavos(s.purchase.price))} in cash on any day up to {formatDate(win.last)} would
                  take you below your {formatPeso(buffer)} buffer.
                </p>
              </article>
            {/if}

            <h3 class="kicker">{c.options.length === 1 ? 'Your option' : 'Your options, best first'}</h3>
            <div class="cards">
              {#each c.options as r, n (optionKey(r.option))}
                <VerdictCard
                  result={r}
                  title={optionTitle(r, s.purchase.date, app.today)}
                  bufferCentavos={buffer}
                  {refYear}
                  best={n === 0 && c.options.length > 1}
                  firstPayment={r.option.type === 'installment' ? shiftMonths(s.purchase.date, 1) : null}
                  resetKey={s.key}
                  onadd={(inc) => add(r.option, s.purchase.date, r.monthlyCentavos, inc)}
                />
              {/each}
            </div>
            {#if c.options.length === 1}
              <p class="hint more">Add an installment on the left to compare paying over time.</p>
            {/if}
          {:else}
            <div class="card intro" aria-busy="true"><p>Checking…</p></div>
          {/if}
        </section>
      </div>
    </div>
    <p class="sr-only" role="status" aria-live="polite">{summary}</p>
  {/if}
</ScreenGate>

<style>
  .page {
    max-width: 52rem;
    padding: 12px 16px 24px;
  }
  .top {
    margin-bottom: 14px;
  }
  h1 {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 800;
    letter-spacing: -0.03em;
  }
  .lede {
    margin: 2px 0 0;
    color: var(--muted);
    font-size: 0.9375rem;
    text-wrap: pretty;
  }

  .layout {
    display: grid;
    gap: 14px;
    align-items: start;
  }
  @media (min-width: 1024px) {
    .page {
      max-width: 72rem;
      padding: 32px;
    }
    .layout {
      grid-template-columns: minmax(20rem, 25rem) minmax(0, 1fr);
      gap: 24px;
    }
    .form {
      position: sticky;
      top: 32px;
    }
  }

  .card {
    min-width: 0;
    padding: 16px;
    border-radius: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .form {
    display: grid;
    gap: 16px;
  }

  /* ---------- fields (same look as the item editor) ---------- */
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  legend,
  label {
    display: block;
    margin-bottom: 6px;
    padding: 0;
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--text);
  }
  .opt {
    font-weight: 600;
    color: var(--muted);
  }
  .field {
    display: grid;
    min-width: 0;
    align-content: start;
  }
  input[type='text'],
  input[type='date'] {
    width: 100%;
    min-height: 48px;
    padding: 10px 12px;
    border: 1.5px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
    transition: border-color 140ms ease-out;
  }
  input::placeholder {
    color: var(--muted);
  }
  input:hover {
    border-color: color-mix(in srgb, var(--muted) 60%, var(--border));
  }
  input:focus-visible {
    outline: none;
    border-color: var(--teal);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--teal) 30%, transparent);
  }
  [aria-invalid='true'] {
    border-color: var(--coral);
  }

  .money-in {
    display: flex;
    align-items: center;
    min-height: 48px;
    border: 1.5px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    transition: border-color 140ms ease-out;
  }
  .money-in:hover {
    border-color: color-mix(in srgb, var(--muted) 60%, var(--border));
  }
  .money-in:focus-within {
    border-color: var(--teal);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--teal) 30%, transparent);
  }
  .money-in.bad {
    border-color: var(--coral);
  }
  .money-in .sym {
    flex: none;
    padding-left: 13px;
    color: var(--muted);
    font-size: 1.0625rem;
    font-weight: 700;
  }
  .money-in input[type='text'] {
    min-width: 0;
    padding-left: 6px;
    border: 0;
    background: transparent;
    font-weight: 800;
  }
  .money-in input[type='text']:focus-visible {
    box-shadow: none;
  }
  .money-in.big {
    min-height: 56px;
  }
  .money-in.big .sym {
    font-size: 1.25rem;
  }
  .money-in.big input[type='text'] {
    font-size: 1.5rem;
    letter-spacing: -0.01em;
  }

  .hint,
  .err {
    margin: 6px 0 0;
    font-size: 0.875rem;
    line-height: 1.45;
  }
  .hint {
    color: var(--muted);
  }
  .hint.inline {
    margin: 0;
  }
  .err {
    color: var(--coral-text);
    font-weight: 600;
  }

  /* ---------- ways to pay ---------- */
  .ways {
    display: grid;
    gap: 10px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .ways legend {
    float: left;
    width: 100%;
    margin-bottom: 0;
  }
  .cash-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 48px;
    padding: 8px 14px;
    border-radius: 12px;
    background: var(--surface-2);
  }
  .cash-name {
    font-weight: 800;
  }
  .row {
    padding: 10px 12px 12px;
    border-radius: 12px;
    background: var(--surface-2);
  }
  .row-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: -4px 0 6px;
  }
  .row-title {
    font-weight: 800;
  }
  .pair {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr);
    gap: 0 10px;
  }
  .remove,
  .add-row,
  .link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 8px 12px;
    border: 0;
    border-radius: 12px;
    background: none;
    color: var(--teal-text);
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
  }
  .remove {
    margin-right: -8px;
    color: var(--text);
  }
  .remove:hover,
  .add-row:hover,
  .link:hover {
    background: color-mix(in srgb, var(--text) 8%, transparent);
  }
  .add-row {
    justify-self: start;
    border: 1.5px dashed color-mix(in srgb, var(--teal) 60%, var(--border));
    padding: 8px 16px 8px 12px;
  }
  .add-row:active {
    transform: scale(0.97);
  }
  .remove svg,
  .add-row svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  .remove svg {
    width: 16px;
    height: 16px;
  }

  /* ---------- results ---------- */
  .results {
    display: grid;
    gap: 10px;
    min-width: 0;
  }
  .results h3 {
    margin: 0;
  }
  .intro h3,
  .notice h3,
  .nobest h3 {
    font-size: 1.0625rem;
    font-weight: 800;
    line-height: 1.3;
  }
  .intro p,
  .notice p,
  .nobest p {
    margin: 6px 0 0;
    color: var(--muted);
    font-size: 0.9375rem;
    text-wrap: pretty;
  }
  .intro > p:only-child {
    margin: 0;
  }
  .notice {
    background: color-mix(in srgb, var(--mango) 9%, var(--surface));
    border-color: color-mix(in srgb, var(--mango) 45%, transparent);
  }
  .notice p {
    color: var(--text);
  }
  .notice .link {
    margin: 6px 0 0 -12px;
  }
  .legend {
    display: grid;
    gap: 8px;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
    font-size: 0.9375rem;
  }
  .legend li {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 8px;
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 10px;
    padding: 2px 2px 4px;
  }
  .summary p {
    margin: 0;
  }
  .s-name {
    flex-basis: 100%;
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .s-price {
    font-size: 1.75rem;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.15;
  }
  .s-date {
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--muted);
  }

  .bestcard {
    padding: 14px 16px 16px;
    border-radius: 16px;
    background: color-mix(in srgb, var(--mango) 10%, var(--surface));
    border: 1.5px solid color-mix(in srgb, var(--mango) 70%, transparent);
  }
  .b-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }
  .b-head h3 {
    font-size: 1.125rem;
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.3;
  }
  .spark {
    margin-right: 0.3em;
    color: var(--mango);
  }
  .reason {
    margin: 2px 0 0;
    font-size: 0.9375rem;
    color: var(--muted);
  }
  .ln {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0 12px;
    margin-top: 8px;
  }
  .dt {
    font-size: 0.9375rem;
    color: var(--muted);
  }
  .dd {
    font-size: 0.9375rem;
    font-weight: 800;
  }

  .kicker {
    margin: 6px 0 0;
    font-size: 0.875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--muted);
  }
  .cards {
    display: grid;
    gap: 10px;
  }
  .more {
    margin: 0;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    padding: 3px 9px;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 800;
    white-space: nowrap;
  }
  .tag svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tag.kaya {
    color: var(--teal-text);
    background: color-mix(in srgb, var(--teal) 18%, transparent);
  }
  .tag.gipit,
  .tag.hindiKaya {
    color: var(--coral-text);
    background: color-mix(in srgb, var(--coral) 18%, transparent);
  }
</style>
