<script lang="ts">
  import Logo from './Logo.svelte';
  import type { Route } from '../lib/state.svelte';

  let { route }: { route: Route } = $props();

  type Tab = { id: Route; label: string; icon: string };
  // Icon paths are 24×24, drawn with a 2px stroke in currentColor.
  const tabs: Tab[] = [
    { id: 'timeline', label: 'Timeline', icon: 'M3 18 L9 11 L13 14 L21 5' },
    { id: 'cutoffs', label: 'Cutoffs', icon: 'M4 6.5h16v13.5h-16z M4 10.5h16 M8.5 3.5v5 M15.5 3.5v5' },
    { id: 'plans', label: 'Plans', icon: 'M4 7h10 M9 12h11 M4 17h7' },
    {
      id: 'kaya',
      label: 'Kaya ba?',
      icon: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18z M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.7.3-1.2.9-1.2 1.7v.4 M12 16.9v.2',
    },
    { id: 'items', label: 'Items', icon: 'M9 6.5h11 M9 12h11 M9 17.5h11 M4.5 6.5v.1 M4.5 12v.1 M4.5 17.5v.1' },
  ];

  const gear =
    'M19.38 10.17L21.89 10.51L21.89 13.49L19.38 13.83L18.51 15.92L20.04 17.94L17.94 20.04L15.92 18.51L13.83 19.38L13.49 21.89L10.51 21.89L10.17 19.38L8.08 18.51L6.06 20.04L3.96 17.94L5.49 15.92L4.62 13.83L2.11 13.49L2.11 10.51L4.62 10.17L5.49 8.08L3.96 6.06L6.06 3.96L8.08 5.49L10.17 4.62L10.51 2.11L13.49 2.11L13.83 4.62L15.92 5.49L17.94 3.96L20.04 6.06L18.51 8.08Z M12 15a3 3 0 1 0 0-6a3 3 0 0 0 0 6z';
  const lock = 'M6 11h12v9.5h-12z M8.5 11V8a3.5 3.5 0 0 1 7 0v3';
</script>

{#snippet icon(d: string)}
  <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
    <path {d} />
  </svg>
{/snippet}

<!-- Phones: slim app bar with the brand and the Settings gear. -->
<header class="appbar">
  <a class="brand" href="#/timeline">
    <span aria-hidden="true"><Logo size={28} /></span>
    <span class="word">lantaw</span>
  </a>
  <a class="gear" href="#/settings" aria-label="Settings" aria-current={route === 'settings' ? 'page' : undefined}>
    {@render icon(gear)}
  </a>
</header>

<!-- Phones: bottom tab bar. 1024px and wider: left rail. -->
<nav class="tabs" aria-label="Main">
  <a class="brand rail-only" href="#/timeline">
    <span aria-hidden="true"><Logo size={32} /></span>
    <span class="word">lantaw</span>
  </a>
  <ul>
    {#each tabs as tab (tab.id)}
      <li>
        <a href="#/{tab.id}" aria-current={route === tab.id ? 'page' : undefined}>
          <span class="pill">{@render icon(tab.icon)}</span>
          <span class="label">{tab.label}</span>
        </a>
      </li>
    {/each}
  </ul>
  <div class="foot rail-only">
    <a href="#/settings" aria-current={route === 'settings' ? 'page' : undefined}>
      <span class="pill">{@render icon(gear)}</span>
      <span class="label">Settings</span>
    </a>
    <p class="private">
      {@render icon(lock)}
      <span>Stored only on this device</span>
    </p>
  </div>
</nav>

<style>
  .ico {
    width: 22px;
    height: 22px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--text);
    text-decoration: none;
    border-radius: 10px;
  }
  .brand span[aria-hidden] {
    display: flex;
  }
  .word {
    font-size: 1.25rem;
    font-weight: 800;
    letter-spacing: -0.04em;
  }

  /* ---------- phones ---------- */
  .appbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    padding-top: max(10px, env(safe-area-inset-top));
    background: var(--bg);
  }
  .gear {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-right: -8px;
    border-radius: 12px;
    color: var(--muted);
  }
  .gear:hover,
  .gear[aria-current='page'] {
    color: var(--teal-text);
    background: var(--surface-2);
  }

  .tabs {
    position: fixed;
    inset: auto 0 0 0;
    z-index: 30;
    background: var(--surface);
    border-top: 1px solid var(--border);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .tabs ul {
    display: flex;
    margin: 0;
    padding: 0 4px;
    list-style: none;
  }
  .tabs li {
    flex: 1 1 0;
    min-width: 0;
  }
  .tabs ul a {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-height: 64px;
    padding: 8px 2px 6px;
    color: var(--muted);
    text-decoration: none;
    border-radius: 12px;
  }
  .label {
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
  }
  .pill {
    display: grid;
    place-items: center;
    width: 52px;
    height: 30px;
    border-radius: 99px;
    transition: background-color 160ms ease-out;
  }
  .tabs a[aria-current='page'] {
    color: var(--teal-text);
  }
  .tabs a[aria-current='page'] .pill {
    background: color-mix(in srgb, var(--teal) 18%, transparent);
  }
  .tabs ul a:hover {
    color: var(--text);
  }
  .tabs ul a[aria-current='page']:hover {
    color: var(--teal-text);
  }

  .rail-only {
    display: none;
  }

  /* ---------- 1024px and wider: left rail ---------- */
  @media (min-width: 1024px) {
    .appbar {
      display: none;
    }
    .rail-only {
      display: flex;
    }
    .tabs {
      position: sticky;
      top: 0;
      inset: auto;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 22px 14px 18px;
      background: var(--bg);
      border-top: 0;
      border-right: 1px solid var(--border);
    }
    .tabs .brand {
      padding: 4px 8px;
      margin-bottom: 22px;
    }
    .tabs ul {
      flex-direction: column;
      gap: 4px;
      padding: 0;
    }
    .tabs ul a,
    .foot a {
      flex-direction: row;
      gap: 12px;
      min-height: 46px;
      padding: 8px 12px;
      color: var(--muted);
      text-decoration: none;
      border-radius: 12px;
    }
    .label {
      font-size: 0.9375rem;
    }
    .pill {
      width: auto;
      height: auto;
      background: none !important;
    }
    .tabs a[aria-current='page'] {
      background: var(--surface-2);
      color: var(--teal-text);
    }
    .tabs ul a:hover,
    .foot a:hover {
      color: var(--text);
      background: var(--surface-2);
    }
    .tabs ul a[aria-current='page']:hover,
    .foot a[aria-current='page']:hover {
      color: var(--teal-text);
    }
    .foot {
      margin-top: auto;
      flex-direction: column;
      gap: 6px;
    }
    .foot a {
      display: flex;
      align-items: center;
    }
    .private {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 0;
      padding: 8px 12px;
      font-size: 0.875rem;
      color: var(--muted);
    }
    .private .ico {
      width: 18px;
      height: 18px;
    }
  }
</style>
