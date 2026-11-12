<script lang="ts">
  import Logo from './components/Logo.svelte';
</script>

<main class="shell">
  <Logo size={72} />
  <h1>lantaw</h1>
</main>

<style>
  .shell {
    min-height: 100dvh;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--space-3);
  }
  h1 {
    margin: 0;
    font-size: 2rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
</style>
