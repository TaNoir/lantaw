<script lang="ts">
  // Registers the service worker and, when a new version has been downloaded
  // and is waiting, offers "New version available · Reload". Nothing reloads
  // on its own: typing in a form is never interrupted.
  import { onMount } from 'svelte';
  import { registerSW } from 'virtual:pwa-register';

  /** True when the phone's bottom tab bar is showing, so the toast sits above it. */
  let { raised = false }: { raised?: boolean } = $props();

  let needRefresh = $state(false);
  let reloading = $state(false);
  let updateSW: ((reload?: boolean) => Promise<void>) | undefined;

  const HOUR = 60 * 60 * 1000;

  onMount(() => {
    if (!('serviceWorker' in navigator)) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        needRefresh = true;
      },
      // A PWA can stay open for days: look for a new version every hour.
      onRegisteredSW(_url, reg) {
        if (reg) timer = setInterval(() => void reg.update().catch(() => {}), HOUR);
      },
    });
    return () => clearInterval(timer);
  });

  async function reload() {
    reloading = true;
    // Activates the waiting worker; the page reloads once it takes over.
    await updateSW?.(true);
  }
</script>

<!-- The live region is always present so the message is announced when it appears. -->
<div class="region" class:raised role="status" aria-live="polite">
  {#if needRefresh}
    <div class="toast" data-testid="update-toast">
      <p class="msg">New version available <span aria-hidden="true">·</span></p>
      <button type="button" class="reload" onclick={reload} aria-busy={reloading || undefined} disabled={reloading}>
        {reloading ? 'Reloading…' : 'Reload'}
      </button>
      <button type="button" class="close" aria-label="Not now" onclick={() => (needRefresh = false)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8 M12 4l-8 8" /></svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .region {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: calc(16px + env(safe-area-inset-bottom));
    z-index: 90;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  /* Phones: above the fixed bottom tab bar. */
  .region.raised {
    bottom: calc(80px + 12px + env(safe-area-inset-bottom));
  }
  @media (min-width: 1024px) {
    .region,
    .region.raised {
      left: auto;
      right: 24px;
      bottom: 24px;
    }
  }

  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    padding: 6px 6px 6px 16px;
    border: 1.5px solid var(--border);
    border-radius: 14px;
    background: var(--surface-2);
    color: var(--text);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.28);
    animation: rise 220ms cubic-bezier(0.22, 0.8, 0.25, 1);
  }
  @keyframes rise {
    from {
      transform: translateY(12px);
      opacity: 0;
    }
  }

  .msg {
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 700;
  }
  .reload {
    min-height: 44px;
    padding: 8px 12px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--teal-text);
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 800;
    cursor: pointer;
  }
  .reload:hover {
    background: color-mix(in srgb, var(--teal) 14%, transparent);
  }
  .reload:disabled {
    cursor: progress;
  }
  .close {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    flex: none;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .close:hover {
    color: var(--text);
  }
  .close svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
</style>
