<script lang="ts">
  import type { OptionResult } from '../lib/engine-types';
  import { belowLine, planTotalNote, verdictLabel } from '../lib/kaya';
  import { formatPeso } from '../lib/money';
  import { formatShort } from '../lib/dates';
  import AddToPlan from './AddToPlan.svelte';

  // One Kaya ba? option: the verdict tag, the lowest balance it leads to, what
  // it costs in total and (for installments) each month, and "Add to plan".
  let {
    result,
    title,
    bufferCentavos,
    refYear,
    best = false,
    firstPayment = null,
    onadd,
    resetKey,
  }: {
    result: OptionResult;
    title: string;
    bufferCentavos: number;
    /** Dates in this year drop the year ("Feb 28"). */
    refYear: number;
    /** The first card when there are several and it isn't Hindi kaya: marked "Best of these". */
    best?: boolean;
    /** Installments: the date of the first monthly payment. */
    firstPayment?: string | null;
    onadd: (included: boolean) => Promise<string | null>;
    resetKey: string;
  } = $props();

  const low = $derived(result.lowest.centavos < bufferCentavos);
  const months = $derived(result.option.type === 'installment' ? result.option.months : 0);
  const note = $derived(
    result.monthlyCentavos === null ? null : planTotalNote(result.monthlyCentavos, months, result.totalPaidCentavos),
  );
</script>

<article class="card {result.verdict}" class:best aria-label="{title}: {verdictLabel(result.verdict)}">
  <header class="head">
    <div class="title-wrap">
      <h3 class="title">{title}</h3>
      {#if best}<span class="best-chip">Best of these</span>{/if}
    </div>
    <span class="tag {result.verdict}" data-testid="verdict-tag">
      {#if result.verdict === 'kaya'}
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3l6-7" /></svg>
      {:else if result.verdict === 'gipit'}
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v5.5 M8 12.2v.1" /></svg>
      {:else}
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7 M11.5 4.5l-7 7" /></svg>
      {/if}
      {verdictLabel(result.verdict)}
    </span>
  </header>

  <dl class="lines">
    <div class="ln">
      <dt>Lowest</dt>
      <dd class:low>{formatPeso(result.lowest.centavos)} · {formatShort(result.lowest.date, refYear)}</dd>
    </div>
    <div class="ln">
      <dt>Total paid</dt>
      <dd>
        {formatPeso(result.totalPaidCentavos)}
        {#if result.addOnCentavos > 0}<span class="addon">(+{formatPeso(result.addOnCentavos)})</span>{/if}
      </dd>
    </div>
    {#if result.monthlyCentavos !== null}
      <div class="ln">
        <dt>Monthly hulog</dt>
        <dd>
          {formatPeso(result.monthlyCentavos)} × {months}
          {#if firstPayment}<span class="addon">· from {formatShort(firstPayment, refYear)}</span>{/if}
        </dd>
      </div>
    {/if}
  </dl>
  <p class="below" class:low={result.daysBelowBuffer > 0}>{belowLine(result, bufferCentavos)}</p>

  <AddToPlan what={title} {onadd} {resetKey} {note} />
</article>

<style>
  .card {
    min-width: 0;
    padding: 14px 16px 16px;
    border-radius: 22px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  /* Hindi kaya sits on the page colour, a step down from the other cards. */
  .card.hindiKaya {
    background: var(--bg);
  }
  .card.best {
    background: color-mix(in srgb, var(--teal) 7%, var(--surface));
    border-color: color-mix(in srgb, var(--teal) 35%, var(--border));
  }
  .card.best.hindiKaya {
    background: color-mix(in srgb, var(--teal) 5%, var(--bg));
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }
  .title-wrap {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    min-width: 0;
  }
  .title {
    margin: 0;
    font-size: 1.0625rem;
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .best-chip {
    padding: 2px 8px;
    border-radius: 99px;
    border: 1px solid color-mix(in srgb, var(--teal) 55%, transparent);
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--teal-text);
    white-space: nowrap;
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

  .lines {
    margin: 10px 0 0;
  }
  .ln {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0 12px;
    padding: 4px 0;
  }
  dt {
    font-size: 0.9375rem;
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  dd.low {
    color: var(--coral-text);
  }
  .addon {
    font-weight: 600;
    color: var(--muted);
  }
  .below {
    margin: 6px 0 0;
    font-size: 0.875rem;
    color: var(--muted);
  }
  .below.low {
    color: var(--text);
  }
</style>
