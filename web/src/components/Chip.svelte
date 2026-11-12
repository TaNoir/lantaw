<script lang="ts">
  import type { Snippet } from 'svelte';

  type Tone = 'coral' | 'teal' | 'mango' | 'plain';
  type Icon = 'dot' | 'flag' | 'down' | 'star' | 'none';

  let {
    tone = 'plain',
    icon = 'none',
    onclick,
    title,
    children,
  }: {
    tone?: Tone;
    icon?: Icon;
    /** When set the chip is a button (e.g. "jump the scrubber here"). */
    onclick?: () => void;
    title?: string;
    children: Snippet;
  } = $props();
</script>

{#snippet glyph()}
  {#if icon === 'dot'}
    <svg class="g" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4" /></svg>
  {:else if icon === 'flag'}
    <svg class="g" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 11V1.5h7l-1.6 2.6l1.6 2.6h-7" /></svg>
  {:else if icon === 'down'}
    <svg class="g" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 3.5h8L6 9.5z" /></svg>
  {:else if icon === 'star'}
    <svg class="g" viewBox="0 0 12 12" aria-hidden="true"
      ><path d="M6 1l1.5 3.2l3.5.4l-2.6 2.4l.7 3.5L6 8.8L2.9 10.5l.7-3.5L1 4.6l3.5-.4z" /></svg
    >
  {/if}
{/snippet}

{#if onclick}
  <button type="button" class="chip {tone}" {onclick} {title}>
    {@render glyph()}<span>{@render children()}</span>
  </button>
{:else}
  <span class="chip {tone}" {title}>
    {@render glyph()}<span>{@render children()}</span>
  </span>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 36px;
    padding: 6px 12px;
    border: 1px solid transparent;
    border-radius: 99px;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 700;
    line-height: 1.25;
    color: var(--text);
    background: var(--surface-2);
    text-align: left;
  }
  button.chip {
    cursor: pointer;
    transition:
      transform 120ms ease-out,
      border-color 160ms ease-out;
  }
  button.chip:hover {
    border-color: currentColor;
  }
  button.chip:active {
    transform: scale(0.97);
  }
  .g {
    width: 12px;
    height: 12px;
    flex: none;
    fill: currentColor;
  }

  .coral {
    color: var(--coral-text);
    background: color-mix(in srgb, var(--coral) 16%, transparent);
  }
  .teal {
    color: var(--teal-text);
    background: color-mix(in srgb, var(--teal) 15%, transparent);
  }
  /* Mango text fails contrast on the light theme, so mango chips keep body
     text and carry the colour in the glyph and border only. */
  .mango {
    color: var(--text);
    background: color-mix(in srgb, var(--mango) 14%, transparent);
    border-color: color-mix(in srgb, var(--mango) 55%, transparent);
  }
  .mango .g {
    fill: var(--mango);
  }
  button.mango:hover {
    border-color: var(--mango);
  }
</style>
