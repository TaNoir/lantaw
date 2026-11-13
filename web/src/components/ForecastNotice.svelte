<script lang="ts">
  // "Your forecast needs attention": shown on every forecast screen (Timeline,
  // Cutoffs, Plans, Kaya ba?, Items) when a counted item needs an exchange
  // rate that isn't saved, or the engine couldn't run. A missing rate can be
  // typed in right here.
  import { app } from '../lib/state.svelte';
  import { parseRate } from '../lib/money';
  import { forecastNotice, rateNoticeText } from '../lib/notice';

  const notice = $derived(forecastNotice(app.missingRate, app.fetchingRates, app.error));
  const SAVE_FAILED = 'Couldn’t save the rate on this device. Check that site data is allowed, then try again.';

  let rateRaw = $state('');
  let rateError = $state('');
  let saving = $state(false);

  async function submitRate(e: SubmitEvent) {
    e.preventDefault();
    if (saving || notice?.kind !== 'rate') return;
    const cur = notice.currency;
    const r = parseRate(rateRaw);
    if (!r.ok) {
      rateError = r.error;
      return;
    }
    rateError = '';
    saving = true;
    try {
      await app.saveManualRate(cur, r.value);
      rateRaw = '';
    } catch {
      rateError = SAVE_FAILED;
    } finally {
      saving = false;
    }
  }
</script>

{#if notice}
  <section class="notice" class:danger={notice.kind === 'error'} aria-labelledby="fn-title">
    <p class="title" id="fn-title">Your forecast needs attention</p>
    {#if notice.kind === 'rate'}
      <p role="status">{rateNoticeText(notice.currency, notice.fetching)}</p>
      <form class="rate" onsubmit={submitRate} novalidate>
        <label for="fn-rate">₱ per 1 {notice.currency}</label>
        <div class="rate-row">
          <input
            id="fn-rate"
            inputmode="decimal"
            autocomplete="off"
            placeholder="e.g. 58.25"
            bind:value={rateRaw}
            aria-invalid={rateError ? 'true' : undefined}
            aria-describedby={rateError ? 'fn-rate-err' : undefined}
          />
          <button class="btn" type="submit" aria-disabled={saving || undefined} aria-busy={saving || undefined}>
            {saving ? 'Saving…' : 'Save rate'}
          </button>
        </div>
        <div role="alert">
          {#if rateError}<p id="fn-rate-err" class="field-error">{rateError}</p>{/if}
        </div>
      </form>
    {:else}
      <p role="alert">Lantaw couldn’t update your forecast: {notice.detail}</p>
      {#if app.view !== 'items'}<a class="btn ghost" href="#/items">Check your items</a>{/if}
    {/if}
  </section>
{/if}

<style>
  .notice {
    display: grid;
    gap: 8px;
    min-width: 0;
    padding: 14px 16px;
    border-radius: var(--radius, 16px);
    background: color-mix(in srgb, var(--mango) 9%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--mango) 45%, transparent);
  }
  .notice.danger {
    background: color-mix(in srgb, var(--coral) 9%, var(--surface));
    border-color: color-mix(in srgb, var(--coral) 45%, transparent);
  }
  p {
    margin: 0;
    font-size: 0.9375rem;
    color: var(--text);
    text-wrap: pretty;
  }
  .title {
    font-size: 1rem;
    font-weight: 800;
  }
  .rate {
    margin-top: 4px;
  }
  .rate label {
    display: block;
    margin-bottom: 6px;
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--text);
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
    outline: none;
    border-color: var(--teal);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--teal) 30%, transparent);
  }
  .rate input[aria-invalid='true'] {
    border-color: var(--coral);
  }
  .field-error {
    margin: 8px 0 0;
    color: var(--coral-text);
    font-weight: 600;
    font-size: 0.875rem;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    justify-self: start;
    min-height: 44px;
    padding: 10px 18px;
    border-radius: 12px;
    border: 1.5px solid transparent;
    background: var(--mango);
    color: var(--on-mango);
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 800;
    text-decoration: none;
    cursor: pointer;
    transition:
      transform 120ms ease-out,
      background-color 160ms ease-out;
  }
  .btn:hover {
    background: color-mix(in srgb, var(--mango) 88%, var(--text));
  }
  .btn:active {
    transform: scale(0.97);
  }
  .btn[aria-disabled='true'] {
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
</style>
