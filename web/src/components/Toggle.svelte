<script lang="ts">
  // An on/off switch: a real button with role="switch", so it is announced as
  // "on"/"off" and works with Space and Enter. `label` is its accessible name
  // when there is no visible label pointing at it (`labelledby`).
  let {
    checked,
    onchange,
    label,
    labelledby,
    describedby,
    id,
    disabled = false,
    busy = false,
  }: {
    checked: boolean;
    onchange: (next: boolean) => void;
    label?: string;
    labelledby?: string;
    describedby?: string;
    id?: string;
    /** Shown as on/off but can't be changed (aria-disabled, so it stays focusable and explained). */
    disabled?: boolean;
    /** A save is in flight: ignore further taps. */
    busy?: boolean;
  } = $props();

  function toggle() {
    if (disabled || busy) return;
    onchange(!checked);
  }
</script>

<button
  type="button"
  role="switch"
  class="switch"
  {id}
  aria-checked={checked}
  aria-label={labelledby ? undefined : label}
  aria-labelledby={labelledby}
  aria-describedby={describedby}
  aria-disabled={disabled || undefined}
  aria-busy={busy || undefined}
  onclick={toggle}
>
  <span class="track" aria-hidden="true"><span class="knob"></span></span>
</button>

<style>
  /* 44px hit area around a 44×26 track. */
  .switch {
    display: inline-grid;
    place-items: center;
    flex: none;
    min-width: 48px;
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .switch:focus-visible {
    outline: none;
  }
  .switch:focus-visible .track {
    outline: 2px solid var(--teal);
    outline-offset: 3px;
  }
  .track {
    position: relative;
    display: block;
    width: 44px;
    height: 26px;
    border-radius: 13px;
    /* Off: an outlined track that still reads against the surface (3:1). */
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1.5px var(--muted);
    transition:
      background-color 160ms ease-out,
      box-shadow 160ms ease-out;
  }
  .knob {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--muted);
    transition:
      transform 180ms cubic-bezier(0.3, 0.7, 0.4, 1),
      background-color 160ms ease-out;
  }
  [aria-checked='true'] .track {
    background: var(--teal);
    box-shadow: none;
  }
  [aria-checked='true'] .knob {
    transform: translateX(18px);
    background: var(--bg);
  }
  .switch:active .knob {
    width: 21px;
  }
  [aria-checked='true'].switch:active .knob {
    transform: translateX(15px);
  }
  [aria-disabled='true'] {
    cursor: not-allowed;
  }
  [aria-disabled='true'] .track {
    background: color-mix(in srgb, var(--teal) 55%, var(--surface-2));
  }
</style>
