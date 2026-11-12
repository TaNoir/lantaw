<script lang="ts">
  import Toggle from './Toggle.svelte';
  import type { StoredItem } from '../lib/db';
  import { formatMoney, scheduleLabel, type KindType } from '../lib/items';

  let {
    item,
    progress,
    approx,
    busy = false,
    onopen,
    ontoggle,
  }: {
    item: StoredItem;
    /** "3 of 12 · ends Aug 2027" for hulog, the turn for a paluwagan. */
    progress: string | null;
    /** "≈ ₱1,275" for a foreign-currency item when a rate is known. */
    approx: string | null;
    busy?: boolean;
    onopen: (item: StoredItem, opener: HTMLElement) => void;
    ontoggle: (item: StoredItem, included: boolean) => void;
  } = $props();

  // 24×24 outline icons, one per kind, drawn in currentColor.
  const ICONS: Record<KindType, string> = {
    income: 'M3 7h18v10H3z M12 14.5a2.5 2.5 0 1 0 0-5a2.5 2.5 0 0 0 0 5z M6.5 10v.1 M17.5 14v.1',
    bill: 'M6 3h12v18l-3-2l-3 2l-3-2l-3 2z M9 8h6 M9 12h6',
    installment: 'M4 6.5h16v13.5h-16z M4 10.5h16 M8.5 3.5v5 M15.5 3.5v5 M9 15.5l2 2l4-4',
    paluwagan: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3 M19.5 4.5v4h-4',
    oneOff: 'M3.5 12.5V4h8.5l8.5 8.5l-8 8z M8 8.5v.1',
  };

  const isMain = $derived(item.kind.type === 'income' && item.kind.mainSweldo);
  const isForeign = $derived(item.currency !== 'PHP');
  const money = $derived(formatMoney(item.amount, item.currency));
  const k = $derived(item.kind);

  /** The detail line under the name, joined with " · ". */
  const detail = $derived.by(() => {
    const parts: string[] = [];
    if (!item.included) parts.push('what-if');
    let amount = isForeign && approx ? `${money} ${approx}` : money;
    if (k.type === 'oneOff') amount += k.direction === 'in' ? ' in' : ' out';
    parts.push(amount);
    // Hulog and paluwagan show their progress instead of the (usually monthly) schedule.
    if (progress) parts.push(progress);
    else parts.push(scheduleLabel(item.schedule));
    if (item.paidFrom) parts.push(item.paidFrom);
    return parts.join(' · ');
  });

  let openBtn: HTMLButtonElement | undefined = $state();
</script>

<li class="row" class:whatif={!item.included}>
  <button type="button" class="open" bind:this={openBtn} onclick={() => openBtn && onopen(item, openBtn)}>
    <span class="ic" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d={ICONS[k.type]} /></svg>
    </span>
    <span class="text">
      <span class="name">
        <span class="sr-only">Edit </span>{item.name}
        {#if isMain}
          <span class="main">
            <svg viewBox="0 0 12 12" aria-hidden="true"
              ><path d="M6 1l1.5 3.2l3.5.4l-2.6 2.4l.7 3.5L6 8.8L2.9 10.5l.7-3.5L1 4.6l3.5-.4z" /></svg
            ><span class="sr-only">, main sweldo</span>
          </span>
        {/if}
      </span>
      <span class="detail">{detail}</span>
    </span>
  </button>
  <Toggle
    checked={item.included}
    label="Count {item.name} in the forecast"
    {busy}
    onchange={(next) => ontoggle(item, next)}
  />
</li>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    border-bottom: 1px solid var(--border);
  }
  .row:last-child {
    border-bottom: 0;
  }
  .open {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    gap: 12px;
    margin: 0 0 0 -8px;
    padding: 10px 8px;
    border: 0;
    border-radius: 12px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 140ms ease-out;
  }
  .open:hover {
    background: color-mix(in srgb, var(--surface-2) 70%, transparent);
  }
  .open:active {
    background: var(--surface-2);
  }
  .ic {
    display: grid;
    place-items: center;
    flex: none;
    width: 38px;
    height: 38px;
    border-radius: 11px;
    background: var(--surface-2);
    color: var(--teal-text);
    border: 1.5px solid transparent;
  }
  .ic svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .text {
    display: grid;
    min-width: 0;
    gap: 1px;
  }
  .name {
    font-size: 1rem;
    font-weight: 700;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .main svg {
    display: inline-block;
    width: 14px;
    height: 14px;
    margin-left: 4px;
    vertical-align: -1px;
    fill: var(--mango);
  }
  .detail {
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  /* What-if: italic text and a dashed icon outline, never faded. */
  .whatif .name,
  .whatif .detail {
    font-style: italic;
  }
  .whatif .ic {
    background: transparent;
    border: 1.5px dashed var(--muted);
    color: var(--muted);
  }
</style>
