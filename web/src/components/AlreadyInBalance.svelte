<script lang="ts">
  // "Already in your balance?": one checkbox per item dated on the balance's
  // as-of date. Ticked means it already came in or went out (it goes into
  // `paidOnAsOf`); unticked, the default, means it still counts as upcoming.
  // Used at the end of first run and again when the balance is updated.
  import type { EngineEvent } from '../lib/engine-types';
  import { formatPeso } from '../lib/money';
  import { checklistRows, togglePaid } from '../lib/onboarding';

  let {
    events,
    paid,
    onchange,
    label = 'Already in your balance?',
  }: {
    /** Events dated on the as-of date (from `dueOnAsOf`). */
    events: EngineEvent[];
    /** The current `paidOnAsOf`. */
    paid: string[];
    onchange: (next: string[]) => void;
    /** The list's accessible name. */
    label?: string;
  } = $props();

  const rows = $derived(checklistRows(events));
  const uid = $props.id();
</script>

<ul class="list" aria-label={label}>
  {#each rows as r (r.itemId)}
    {@const id = `${uid}-${r.itemId}`}
    <li>
      <input
        class="cb"
        type="checkbox"
        {id}
        checked={paid.includes(r.itemId)}
        onchange={(e) => onchange(togglePaid(paid, r.itemId, e.currentTarget.checked))}
      />
      <label for={id} class="row">
        <span class="box" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </span>
        <span class="nm">
          <span class="name">{r.name}</span>
          {#if r.note}<span class="note">{r.note}</span>{/if}
        </span>
        <span class="amt" class:pos={r.centavos > 0}>{r.centavos > 0 ? '+' : ''}{formatPeso(r.centavos)}</span>
      </label>
    </li>
  {/each}
</ul>

<style>
  .list {
    display: grid;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    position: relative;
  }
  /* The real checkbox stays in the page for keyboards and screen readers; the
     box beside the label draws its state. */
  .cb {
    position: absolute;
    top: 0;
    left: 0;
    width: 1px;
    height: 1px;
    margin: 0;
    clip: rect(0 0 0 0);
    overflow: hidden;
    white-space: nowrap;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding: 10px 14px;
    border-radius: 14px;
    border: 1.5px solid var(--border);
    background: var(--surface);
    cursor: pointer;
    transition:
      border-color 160ms ease-out,
      background-color 160ms ease-out;
  }
  .row:hover {
    border-color: var(--teal);
  }
  .cb:focus-visible + .row {
    outline: 2px solid var(--teal);
    outline-offset: 2px;
  }
  .cb:checked + .row {
    border-color: var(--teal);
    background: color-mix(in srgb, var(--teal) 10%, var(--surface));
  }
  .box {
    display: grid;
    place-items: center;
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 7px;
    box-shadow: inset 0 0 0 2px var(--muted);
    transition:
      background-color 140ms ease-out,
      box-shadow 140ms ease-out;
  }
  .box svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: var(--bg);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
    transform: scale(0.6);
    visibility: hidden;
    transition: transform 160ms cubic-bezier(0.3, 0.7, 0.4, 1);
  }
  .cb:checked + .row .box {
    background: var(--teal);
    box-shadow: none;
  }
  .cb:checked + .row .box svg {
    visibility: visible;
    transform: none;
  }
  .nm {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .name {
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .note {
    font-size: 0.875rem;
    color: var(--muted);
  }
  .amt {
    flex: none;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .amt.pos {
    color: var(--teal-text);
  }
</style>
