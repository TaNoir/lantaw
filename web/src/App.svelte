<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Nav from './components/Nav.svelte';
  import Timeline from './screens/Timeline.svelte';
  import Cutoffs from './screens/Cutoffs.svelte';
  import Plans from './screens/Plans.svelte';
  import Items from './screens/Items.svelte';
  import KayaBa from './screens/KayaBa.svelte';
  import Settings from './screens/Settings.svelte';
  import FirstRun from './screens/FirstRun.svelte';
  import UpdatePrompt from './components/UpdatePrompt.svelte';
  import { app, type Route } from './lib/state.svelte';
  import { themeToApply, watchTheme } from './lib/theme';

  let mainEl: HTMLElement | undefined = $state();

  onMount(() => {
    const stop = app.startRouter();
    void app.load();
    return stop;
  });

  // Theme: 'system' leaves it to prefers-color-scheme (see tokens.css); the
  // browser's theme-color follows whichever theme is showing. main.ts applied
  // the last-used theme before mount; nothing changes until settings load.
  $effect(() => {
    const t = themeToApply(app.storedLoaded, app.settings.theme);
    return t ? watchTheme(t) : undefined;
  });

  // On a screen change (including first run -> Timeline), start at the top and
  // move focus into the new screen.
  let lastRoute: Route | null = null;
  $effect(() => {
    const r = app.view;
    if (lastRoute !== null && lastRoute !== r) {
      void tick().then(() => {
        window.scrollTo(0, 0);
        mainEl?.focus({ preventScroll: true });
      });
    }
    lastRoute = r;
  });

</script>

{#if app.showFirstRun}
  <!-- First run has no navigation: it's the whole page until onboarding is done. -->
  <main class="solo" bind:this={mainEl} tabindex="-1">
    <FirstRun />
  </main>
{:else if !app.storedLoaded && app.status !== 'failed'}
  <!-- A few milliseconds while storage is read: blank, so a new visitor never sees the nav flash. -->
  <div class="boot" aria-busy="true"></div>
{:else}
  <button class="skip" type="button" onclick={() => mainEl?.focus()}>Skip to content</button>

  <div class="shell">
    <Nav route={app.view} />
    <main bind:this={mainEl} tabindex="-1">
      {#if app.view === 'timeline'}
        <Timeline />
      {:else if app.view === 'cutoffs'}
        <Cutoffs />
      {:else if app.view === 'plans'}
        <Plans />
      {:else if app.view === 'kaya'}
        <KayaBa />
      {:else if app.view === 'items'}
        <Items />
      {:else}
        <Settings />
      {/if}
    </main>
  </div>
{/if}

<UpdatePrompt raised={!app.showFirstRun && app.storedLoaded} />

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
  main.solo {
    padding-bottom: 0;
  }
  .boot {
    min-height: 100dvh;
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
</style>
