<script lang="ts">
  import Logo from './Logo.svelte';
  import type { Route } from '../lib/state.svelte';

  let { route }: { route: Route } = $props();

  type Tab = { id: Route; label: string; icon: string };
  // Icon paths are 24×24, drawn with a 1.9px stroke in currentColor.
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
    'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1.5 14h5 M9.5 8h5 M17.5 16h5';
  const lock = 'M6 11h12v9.5h-12z M8.5 11V8a3.5 3.5 0 0 1 7 0v3';
</script>

{#snippet icon(d: string)}
  <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
    <path {d} />
  </svg>
{/snippet}

<header class="top">
  <a class="brand" href="#/timeline">
    <span aria-hidden="true"><Logo size={30} /></span>
    <span class="word">lantaw</span>
  </a>

  <!-- 1024px and wider: a pill bar in the middle of the top bar. Phones: a floating tab bar at the bottom. -->
  <nav class="tabs" aria-label="Main">
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
  </nav>

  <div class="end">
    <p class="private">
      {@render icon(lock)}
      <span>Only on this device</span>
    </p>
    <a class="gear" href="#/settings" aria-label="Settings" aria-current={route === 'settings' ? 'page' : undefined}>
      {@render icon(gear)}
    </a>
  </div>
</header>

<style>
  .ico {
    width: 22px;
    height: 22px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .top {
    position: relative;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 16px;
    padding-top: max(10px, env(safe-area-inset-top));
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

  .end {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .private {
    display: none;
    align-items: center;
    gap: 8px;
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--muted);
  }
  .private .ico {
    width: 17px;
    height: 17px;
  }
  .gear {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-right: -6px;
    border-radius: 99px;
    color: var(--muted);
    transition:
      color 160ms ease-out,
      background-color 160ms ease-out;
  }
  .gear:hover {
    color: var(--text);
    background: var(--glass-hover);
  }
  .gear[aria-current='page'] {
    color: var(--on-pill);
    background: var(--pill-on);
  }

  /* ---------- phones: floating tab bar ---------- */
  .tabs {
    position: fixed;
    left: 10px;
    right: 10px;
    bottom: calc(10px + env(safe-area-inset-bottom));
    z-index: 30;
    border-radius: 24px;
    background: var(--glass-solid);
    border: 1px solid var(--glass-line);
    box-shadow: var(--shadow-float);
  }
  .tabs ul {
    display: flex;
    margin: 0;
    padding: 4px;
    list-style: none;
  }
  .tabs li {
    flex: 1 1 0;
    min-width: 0;
  }
  .tabs a {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-height: 58px;
    padding: 6px 2px 5px;
    color: var(--muted);
    text-decoration: none;
    border-radius: 20px;
    transition:
      color 160ms ease-out,
      background-color 160ms ease-out;
  }
  .label {
    font-size: 0.8125rem;
    font-weight: 700;
    line-height: 1.2;
    white-space: nowrap;
  }
  .pill {
    display: grid;
    place-items: center;
    width: 48px;
    height: 28px;
    border-radius: 99px;
    transition: background-color 160ms ease-out;
  }
  .tabs a:hover {
    color: var(--text);
  }
  .tabs a[aria-current='page'] {
    color: var(--text);
  }
  .tabs a[aria-current='page'] .pill {
    background: var(--pill-on);
    color: var(--on-pill);
  }

  /* ---------- 1024px and wider: pill bar in the top bar ---------- */
  @media (min-width: 1024px) {
    .top {
      height: var(--topbar);
      padding: 0 32px;
    }
    .tabs {
      position: absolute;
      left: 50%;
      right: auto;
      bottom: auto;
      top: 50%;
      transform: translate(-50%, -50%);
      border-radius: 99px;
      background: var(--glass);
      box-shadow: none;
    }
    .tabs ul {
      gap: 2px;
    }
    .tabs a {
      flex-direction: row;
      min-height: 40px;
      padding: 0 16px;
      border-radius: 99px;
      gap: 0;
    }
    .pill {
      display: none;
    }
    .label {
      font-size: 0.9375rem;
    }
    .tabs a[aria-current='page'] {
      background: var(--pill-on);
      color: var(--on-pill);
    }
    .private {
      display: flex;
    }
  }
  @media (min-width: 1024px) and (prefers-reduced-transparency: no-preference) {
    .tabs {
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
    }
  }
</style>
