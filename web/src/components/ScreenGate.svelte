<script lang="ts">
  import type { Snippet } from 'svelte';
  import { app } from '../lib/state.svelte';

  // Loading, failed and empty states shared by the Cutoffs and Plans screens
  // (same look as the Timeline's). Renders `children` once there is a forecast.
  let { emptyTitle, emptyBody, children }: { emptyTitle: string; emptyBody: string; children: Snippet } = $props();
</script>

{#if app.status === 'loading'}
  <div class="loading" aria-busy="true">
    <p>Loading your forecast…</p>
    <div class="skeleton"></div>
  </div>
{:else if app.status === 'failed'}
  <section class="notice" role="alert">
    <h2>Lantaw couldn’t start</h2>
    {#if app.failure === 'storage'}
      <p>
        It can’t open its storage on this device. Private browsing or blocked site data can cause this. Allow site data
        for Lantaw, or use a normal window, then reload.
      </p>
    {:else}
      <p>Its forecasting engine didn’t load. Reload the page to try again. Your data is safe on this device.</p>
    {/if}
  </section>
{:else if app.items.length === 0 || !app.projection}
  <section class="empty">
    <svg class="ridge" viewBox="0 0 240 90" aria-hidden="true">
      <path class="ridge-fill" d="M0 70 L40 52 L64 58 L104 22 L120 30 L150 46 L184 38 L240 50 L240 90 L0 90 Z" />
      <path class="ridge-line" d="M0 70 L40 52 L64 58 L104 22 L120 30 L150 46 L184 38 L240 50" />
      <circle class="ridge-dot" cx="104" cy="22" r="6" />
    </svg>
    <h2>{emptyTitle}</h2>
    <p>{emptyBody}</p>
    <a class="btn" href="#/items">Add items</a>
  </section>
{:else}
  {@render children()}
{/if}

<style>
  .empty {
    display: grid;
    justify-items: center;
    gap: 12px;
    max-width: 30rem;
    margin: 0 auto;
    padding: 48px 20px 32px;
    text-align: center;
  }
  .empty h2 {
    margin: 8px 0 0;
    font-size: 1.375rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.25;
    text-wrap: balance;
  }
  .empty p {
    margin: 0 0 8px;
    color: var(--muted);
    text-wrap: pretty;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 10px 18px;
    border-radius: 12px;
    background: var(--mango);
    color: var(--on-mango);
    font-size: 0.9375rem;
    font-weight: 800;
    text-decoration: none;
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
  .ridge {
    width: min(240px, 70vw);
    height: auto;
  }
  .ridge-fill {
    fill: var(--teal);
    fill-opacity: 0.16;
  }
  .ridge-line {
    fill: none;
    stroke: var(--teal);
    stroke-width: 3;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .ridge-dot {
    fill: var(--mango);
    stroke: var(--bg);
    stroke-width: 3;
  }
  .loading {
    padding: 24px 16px;
    color: var(--muted);
  }
  .loading p {
    margin: 0 0 14px;
  }
  .skeleton {
    height: 220px;
    border-radius: 16px;
    background: linear-gradient(100deg, var(--surface) 30%, var(--surface-2) 50%, var(--surface) 70%) 0 0 / 300% 100%;
    animation: shimmer 1.4s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -150% 0;
    }
  }
  .notice {
    max-width: 32rem;
    margin: 32px 16px;
    padding: 18px;
    border-radius: 16px;
    background: color-mix(in srgb, var(--coral) 9%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--coral) 45%, transparent);
  }
  .notice h2 {
    margin: 0 0 6px;
    font-size: 1.125rem;
  }
  .notice p {
    margin: 0;
  }
</style>
