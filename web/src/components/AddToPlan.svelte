<script lang="ts" module>
  let seq = 0;
</script>

<script lang="ts">
  import { tick } from 'svelte';

  // "Add to plan" on a Kaya ba? card: asks "As a real item" or "As what-if",
  // then reports where the new item shows up. `onadd` saves it and returns an
  // error message, or null when it worked.
  let {
    what,
    onadd,
    resetKey,
  }: {
    /** The option being added, for the accessible names ("Cash today"). */
    what: string;
    onadd: (included: boolean) => Promise<string | null>;
    /** When this changes (a new comparison) the panel closes and the "Added" note clears. */
    resetKey: string;
  } = $props();

  const id = `atp-${++seq}`;
  let stage = $state<'closed' | 'open' | 'busy' | 'done'>('closed');
  let addedAs = $state<'real' | 'whatif'>('real');
  let error = $state<string | null>(null);
  let openBtn: HTMLButtonElement | undefined = $state();
  let firstChoice: HTMLButtonElement | undefined = $state();

  let lastKey: string | null = null;
  $effect(() => {
    const k = resetKey;
    if (lastKey !== null && k !== lastKey && stage !== 'busy') {
      stage = 'closed';
      error = null;
    }
    lastKey = k;
  });

  async function open() {
    error = null;
    stage = 'open';
    await tick();
    firstChoice?.focus();
  }

  async function close() {
    stage = 'closed';
    error = null;
    await tick();
    openBtn?.focus();
  }

  async function choose(included: boolean) {
    if (stage === 'busy') return;
    stage = 'busy';
    error = null;
    let msg: string | null;
    try {
      msg = await onadd(included);
    } catch {
      msg = 'Lantaw couldn’t save it on this device. Try again.';
    }
    if (msg) {
      error = msg;
      stage = 'open';
      return;
    }
    addedAs = included ? 'real' : 'whatif';
    stage = 'done';
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && stage === 'open') {
      e.stopPropagation();
      void close();
    }
  }
</script>

<div class="atp">
  {#if stage === 'closed'}
    <button
      type="button"
      class="add"
      bind:this={openBtn}
      aria-expanded="false"
      aria-controls={id}
      aria-label="Add {what} to your plan"
      onclick={open}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14 M5 12h14" /></svg>
      Add to plan
    </button>
  {:else if stage === 'done'}
    <p class="done" role="status">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      <span>
        {addedAs === 'real' ? 'Added to your plan' : 'Added as a what-if'} —
        <a href="#/timeline">see it on the Timeline</a>
      </span>
    </p>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="panel" {id} role="group" aria-label="Add {what} to your plan" {onkeydown}>
      <p class="ask">Add it as</p>
      <div class="choices">
        <button
          type="button"
          class="choice real"
          bind:this={firstChoice}
          disabled={stage === 'busy'}
          onclick={() => choose(true)}
        >
          <span class="c-title">As a real item</span>
          <span class="c-note">Counts in your forecast</span>
        </button>
        <button type="button" class="choice whatif" disabled={stage === 'busy'} onclick={() => choose(false)}>
          <span class="c-title">As what-if</span>
          <span class="c-note">A dashed line on the Timeline, not counted</span>
        </button>
      </div>
      {#if error}
        <p class="err" role="alert">{error}</p>
      {/if}
      <button type="button" class="cancel" disabled={stage === 'busy'} onclick={close}>Cancel</button>
    </div>
  {/if}
</div>

<style>
  .atp {
    margin-top: 12px;
  }
  .add,
  .cancel {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 8px 14px;
    border: 1.5px solid var(--border);
    border-radius: 12px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 700;
    cursor: pointer;
    transition:
      transform 120ms ease-out,
      border-color 160ms ease-out;
  }
  .add:hover,
  .cancel:hover {
    border-color: var(--muted);
  }
  .add:active,
  .choice:active {
    transform: scale(0.97);
  }
  .add svg,
  .done svg {
    width: 18px;
    height: 18px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .cancel {
    border-color: transparent;
    margin-top: 4px;
    margin-left: -14px;
    color: var(--teal-text);
  }
  .cancel:hover {
    border-color: transparent;
    background: var(--surface-2);
  }

  .panel {
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .ask {
    margin: 0 0 8px;
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--muted);
  }
  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
    gap: 8px;
  }
  .choice {
    display: grid;
    gap: 2px;
    min-height: 56px;
    padding: 10px 12px;
    border: 1.5px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      transform 120ms ease-out,
      border-color 160ms ease-out,
      background-color 160ms ease-out;
  }
  .choice:hover {
    border-color: var(--muted);
  }
  .choice.real {
    border-color: var(--mango);
    background: color-mix(in srgb, var(--mango) 14%, var(--bg));
  }
  .choice.whatif {
    border-style: dashed;
    border-color: var(--teal);
  }
  .choice.whatif .c-title {
    font-style: italic;
  }
  .choice:disabled {
    cursor: progress;
  }
  .c-title {
    font-size: 0.9375rem;
    font-weight: 800;
  }
  .c-note {
    font-size: 0.875rem;
    color: var(--muted);
    line-height: 1.35;
  }
  .err {
    margin: 8px 0 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--coral-text);
  }

  .done {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin: 0;
    padding: 10px 12px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--teal) 14%, transparent);
    font-size: 0.9375rem;
    font-weight: 600;
  }
  .done svg {
    margin-top: 2px;
    color: var(--teal-text);
  }
  .done a {
    color: var(--teal-text);
    font-weight: 800;
  }
</style>
