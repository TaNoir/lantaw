<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Nav from './components/Nav.svelte';
  import Timeline from './screens/Timeline.svelte';
  import { app, type Route } from './lib/state.svelte';

  let mainEl: HTMLElement | undefined = $state();

  onMount(() => {
    const stop = app.startRouter();
    void app.load();
    return stop;
  });

  // Theme: 'system' leaves it to prefers-color-scheme (see tokens.css).
  $effect(() => {
    const t = app.settings.theme;
    const root = document.documentElement;
    if (t === 'system') delete root.dataset.theme;
    else root.dataset.theme = t;
  });

  // On a route change, start at the top and move focus into the new screen.
  let lastRoute: Route | null = null;
  $effect(() => {
    const r = app.route;
    if (lastRoute !== null && lastRoute !== r) {
      void tick().then(() => {
        window.scrollTo(0, 0);
        mainEl?.focus({ preventScroll: true });
      });
    }
    lastRoute = r;
  });

  const TITLES: Record<Route, string> = {
    timeline: 'Timeline',
    cutoffs: 'Cutoffs',
    plans: 'Plans',
    kaya: 'Kaya ba?',
    items: 'Items',
    settings: 'Settings',
    'first-run': 'Welcome',
  };
</script>

<button class="skip" type="button" onclick={() => mainEl?.focus()}>Skip to content</button>

<div class="shell">
  <Nav route={app.route} />
  <main bind:this={mainEl} tabindex="-1">
    {#if app.route === 'timeline'}
      <Timeline />
    {:else}
      <section class="soon">
        <h1>{TITLES[app.route]}</h1>
        <p>This screen is still being built. Your forecast is on the Timeline.</p>
        <a href="#/timeline">Go to Timeline</a>
      </section>
    {/if}
  </main>
</div>

<style>
  .shell {
    min-height: 100dvh;
  }
  main {
    min-width: 0;
    /* Room for the fixed bottom tab bar on phones. */
    padding-bottom: calc(80px + env(safe-area-inset-bottom));
  }
  main:focus {
    outline: none;
  }
  @media (min-width: 1024px) {
    .shell {
      display: grid;
      grid-template-columns: 232px minmax(0, 1fr);
    }
    main {
      padding-bottom: 0;
    }
  }

  .skip {
    position: fixed;
    top: 8px;
    left: 8px;
    z-index: 100;
    padding: 10px 14px;
    border: 0;
    border-radius: 10px;
    background: var(--mango);
    color: var(--on-mango);
    font: inherit;
    font-weight: 800;
    transform: translateY(-160%);
  }
  .skip:focus-visible {
    transform: none;
  }

  .soon {
    max-width: 34rem;
    padding: 24px 16px;
  }
  .soon h1 {
    margin: 0 0 8px;
    font-size: 1.75rem;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .soon p {
    margin: 0 0 16px;
    color: var(--muted);
  }
  .soon a {
    color: var(--teal-text);
    font-weight: 700;
  }
  @media (min-width: 1024px) {
    .soon {
      padding: 40px 32px;
    }
  }
</style>
