<script lang="ts">
  import { tick } from 'svelte';
  import ScreenGate from '../components/ScreenGate.svelte';
  import ItemRow from '../components/ItemRow.svelte';
  import ItemEditor from '../components/ItemEditor.svelte';
  import { app } from '../lib/state.svelte';
  import { getCachedRate } from '../lib/apis';
  import type { FxRate } from '../lib/engine-types';
  import type { StoredItem } from '../lib/db';
  import { formatPeso, roundToPeso } from '../lib/money';
  import {
    PRESETS,
    convertToPhp,
    formFromItem,
    groupItems,
    itemProgress,
    matchesSearch,
    presetItem,
    type ItemForm,
    type KindType,
  } from '../lib/items';

  // ---- list ----
  let query = $state('');
  const filtered = $derived(query.trim() ? app.items.filter((i) => matchesSearch(i.name, query)) : app.items);
  const groups = $derived(groupItems(filtered));
  const whatIfCount = $derived(app.items.filter((i) => !i.included).length);

  // ---- foreign-currency previews (cached rates only; never the network) ----
  let rates = $state.raw<Record<string, FxRate | null>>({});
  $effect(() => {
    const curs = [...new Set(app.items.map((i) => i.currency).filter((c) => c !== 'PHP'))];
    void app.projection; // re-read after each recompute, when a refresh may have cached a rate
    let live = true;
    Promise.all(curs.map(async (c) => [c, await getCachedRate(c).catch(() => null)] as const)).then((pairs) => {
      if (live) rates = Object.fromEntries(pairs);
    });
    return () => {
      live = false;
    };
  });

  function approx(item: StoredItem): string | null {
    if (item.currency === 'PHP') return null;
    const r = rates[item.currency];
    if (!r) return '(no ₱ rate yet)';
    const c = convertToPhp(item.amount, r.phpPerUnit, app.settings.cardFxFeePct);
    return c === null ? null : `≈ ${formatPeso(roundToPeso(c))}`;
  }

  // ---- quick add: bill presets already in the list are left out ----
  const presetKeys = $derived.by(() => {
    const names = new Set(app.items.map((i) => i.name.trim().toLowerCase()));
    return Object.keys(PRESETS).filter(
      (k) => PRESETS[k].kind?.type !== 'bill' || !names.has((PRESETS[k].name ?? k).toLowerCase()),
    );
  });

  // ---- the editor ----
  let editor = $state<{ form: ItemForm; isNew: boolean; key: number } | null>(null);
  let opener: HTMLElement | null = null;
  let addBtn: HTMLButtonElement | undefined = $state();
  let headingEl: HTMLHeadingElement | undefined = $state();
  let seq = 0;

  function openEditor(form: ItemForm, isNew: boolean, from: HTMLElement | null) {
    opener = from;
    editor = { form, isNew, key: ++seq };
  }
  function addNew(kind: KindType | null, from: HTMLElement | null) {
    const k = kind ?? (app.items.some((i) => i.kind.type === 'income') ? 'bill' : 'income');
    openEditor(formFromItem({ kind: blankKind(k) }, app.today), true, from);
  }
  function blankKind(k: KindType): StoredItem['kind'] {
    switch (k) {
      case 'income':
        return { type: 'income', mainSweldo: false };
      case 'installment':
        return { type: 'installment', totalPayments: 12, paidOverride: null };
      case 'paluwagan':
        return { type: 'paluwagan', members: 10, myTurn: 1 };
      case 'oneOff':
        return { type: 'oneOff', direction: 'out' };
      default:
        return { type: 'bill' };
    }
  }
  function addPreset(key: string, from: HTMLElement) {
    openEditor(formFromItem(presetItem(key, app.today), app.today), true, from);
  }
  function edit(item: StoredItem, from: HTMLElement) {
    openEditor(formFromItem(item, app.today), false, from);
  }
  async function closeEditor(message?: string) {
    editor = null;
    if (message) announce(message);
    await tick();
    // Back to whatever opened the editor, or the Add button if that is gone.
    const target = opener?.isConnected ? opener : addBtn?.isConnected ? addBtn : headingEl;
    target?.focus();
  }

  // ---- included switch: saves at once ----
  let busy = $state<string[]>([]);
  async function toggle(item: StoredItem, included: boolean) {
    busy = [...busy, item.id];
    try {
      await app.saveItem({ ...item, included });
      announce(included ? `${item.name} is counted again.` : `${item.name} is now a what-if, not counted.`);
    } catch {
      announce(`Couldn’t save ${item.name} on this device. Try again.`);
    } finally {
      busy = busy.filter((id) => id !== item.id);
    }
  }

  // ---- announcements ----
  let message = $state('');
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  function announce(text: string) {
    message = text;
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => (message = ''), 6000);
  }
</script>

{#snippet quickAdd(title: string)}
  {#if presetKeys.length > 0}
    <section class="quick" aria-labelledby="quick-h">
      <h2 id="quick-h" class="kicker">{title}</h2>
      <ul class="chips">
        {#each presetKeys as key (key)}
          <li>
            <button type="button" class="chip" onclick={(e) => addPreset(key, e.currentTarget)}>
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2v8 M2 6h8" /></svg>
              {key}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
{/snippet}

<ScreenGate requireForecast={false}>
  <div class="page">
    <header class="top">
      <h1 bind:this={headingEl} tabindex="-1">Items</h1>
      {#if app.items.length > 0}
        <button type="button" class="btn" bind:this={addBtn} onclick={(e) => addNew(null, e.currentTarget)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14 M5 12h14" /></svg>
          Add
        </button>
      {/if}
    </header>

    {#if app.items.length === 0}
      <section class="empty">
        <h2>Start with your sweldo</h2>
        <p>Add your pay, then the bills and hulog it covers. Lantaw turns them into a day-by-day forecast. Nothing leaves your device.</p>
        <button type="button" class="btn" onclick={(e) => addNew('income', e.currentTarget)}>Add your sweldo</button>
      </section>
      {@render quickAdd('Or quick-add a common one')}
    {:else}
      <div class="layout">
        <div class="main">
          <div class="tools">
            <label class="search">
              <span class="sr-only">Search items by name</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 17a6.5 6.5 0 1 0 0-13a6.5 6.5 0 0 0 0 13z M15.5 15.5L20 20" /></svg>
              <input type="search" placeholder="Search items" autocomplete="off" bind:value={query} />
            </label>
            <p class="lede">
              Switch an item off to make it a what-if. The Timeline shows it as a dashed line without counting it.
              {#if whatIfCount > 0}<span class="count">{whatIfCount} what-if {whatIfCount === 1 ? 'item' : 'items'} now.</span>{/if}
            </p>
          </div>

          {#if groups.length === 0}
            <div class="none">
              <p>No items match “{query.trim()}”.</p>
              <button type="button" class="text-btn" onclick={() => (query = '')}>Clear search</button>
            </div>
          {:else}
            {#each groups as g (g.kind)}
              <section class="card" aria-labelledby="g-{g.kind}">
                <h2 id="g-{g.kind}" class="kicker">
                  {g.title} <span class="n">· {g.items.length}</span>
                </h2>
                <ul class="rows">
                  {#each g.items as item (item.id)}
                    <ItemRow
                      {item}
                      progress={itemProgress(app.projection, item)}
                      approx={approx(item)}
                      busy={busy.includes(item.id)}
                      onopen={edit}
                      ontoggle={toggle}
                    />
                  {/each}
                </ul>
              </section>
            {/each}
          {/if}
        </div>

        <aside class="side">
          {@render quickAdd('Quick add')}
        </aside>
      </div>
    {/if}
  </div>
</ScreenGate>

<p class="sr-only" role="status" aria-live="polite">{message}</p>
{#if message}
  <div class="toast" aria-hidden="true">{message}</div>
{/if}

{#if editor}
  {#key editor.key}
    <ItemEditor initial={editor.form} isNew={editor.isNew} onclose={closeEditor} />
  {/key}
{/if}

<style>
  .page {
    max-width: 52rem;
    padding: 12px 16px 24px;
  }
  @media (min-width: 1024px) {
    .page {
      max-width: 76rem;
      padding: 32px;
    }
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  h1 {
    margin: 0;
    font-size: clamp(2.25rem, 6vw, 2.75rem);
    font-weight: 300;
    line-height: 1.1;
    letter-spacing: -0.04em;
  }
  h1:focus {
    outline: none;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 44px;
    padding: 10px 18px;
    border: 0;
    border-radius: 12px;
    background: var(--mango);
    color: var(--on-mango);
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 800;
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
  .btn svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
  }

  .kicker {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--muted);
  }
  .n {
    font-weight: 600;
  }

  .layout {
    display: grid;
    gap: 14px;
    align-items: start;
  }
  .main {
    display: grid;
    gap: 14px;
    min-width: 0;
  }
  @media (min-width: 1280px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) 20rem;
      gap: 20px;
    }
    .side {
      position: sticky;
      top: 32px;
    }
  }

  .tools {
    display: grid;
    gap: 8px;
  }
  .search {
    position: relative;
    display: block;
  }
  .search svg {
    position: absolute;
    left: 14px;
    top: 50%;
    width: 20px;
    height: 20px;
    transform: translateY(-50%);
    fill: none;
    stroke: var(--muted);
    stroke-width: 2;
    stroke-linecap: round;
    pointer-events: none;
  }
  .search input {
    width: 100%;
    min-height: 48px;
    padding: 10px 14px 10px 44px;
    border: 1.5px solid var(--border);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 1rem;
  }
  .search input::placeholder {
    color: var(--muted);
  }
  .search input:focus-visible {
    outline: none;
    border-color: var(--teal);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--teal) 30%, transparent);
  }
  .lede {
    margin: 0;
    font-size: 0.875rem;
    color: var(--muted);
    text-wrap: pretty;
  }
  .count {
    color: var(--text);
    font-weight: 700;
    color: var(--muted);
  }

  .card {
    min-width: 0;
    padding: 14px 16px 4px;
    border-radius: 22px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .rows {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
  }

  .none {
    padding: 24px 16px;
    border-radius: 22px;
    border: 1px dashed var(--border);
    text-align: center;
  }
  .none p {
    margin: 0 0 6px;
  }
  .text-btn {
    min-height: 44px;
    padding: 8px 12px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--teal-text);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .text-btn:hover {
    background: var(--surface-2);
  }

  .empty {
    display: grid;
    justify-items: start;
    gap: 10px;
    max-width: 34rem;
    margin: 8px 0 24px;
    padding: 20px;
    border-radius: 22px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .empty h2 {
    margin: 0;
    font-size: 1.375rem;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .empty p {
    margin: 0 0 6px;
    color: var(--muted);
    text-wrap: pretty;
  }

  .quick {
    min-width: 0;
  }
  .side .quick {
    padding: 14px 16px 16px;
    border-radius: 22px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 10px 0 0;
    padding: 0;
    list-style: none;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 8px 14px 8px 12px;
    border: 1.5px solid var(--border);
    border-radius: 99px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 700;
    cursor: pointer;
    transition:
      transform 120ms ease-out,
      border-color 160ms ease-out;
  }
  .chip:hover {
    border-color: var(--teal);
  }
  .chip:active {
    transform: scale(0.97);
  }
  .chip svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: var(--teal-text);
    stroke-width: 2;
    stroke-linecap: round;
  }

  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(88px + env(safe-area-inset-bottom));
    z-index: 40;
    max-width: calc(100% - 32px);
    padding: 10px 16px;
    border-radius: 12px;
    background: var(--text);
    color: var(--bg);
    font-size: 0.9375rem;
    font-weight: 700;
    transform: translateX(-50%);
    box-shadow: 0 8px 24px rgb(3 12 18 / 0.35);
    animation: toast-in 200ms ease-out;
  }
  @keyframes toast-in {
    from {
      transform: translate(-50%, 8px);
    }
  }
  @media (min-width: 1024px) {
    .toast {
      bottom: 24px;
      left: calc(50% + 116px);
    }
  }
</style>
