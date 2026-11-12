<script lang="ts">
  let { size = 32 }: { size?: number } = $props();
</script>

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="Lantaw">
  <title>Lantaw</title>
  <rect width="64" height="64" rx="15" fill="#0E2A3A" />
  <path d="M8 47 L19 37 L25 40 L33 21 L38 24 L46 33 L56 29 L56 56 L8 56 Z" fill="#3FB8AF" opacity=".18" />
  <path d="M8 47 L19 37 L25 40 L33 21 L38 24 L46 33 L56 29" fill="none" stroke="#3FB8AF" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round" />
  <circle cx="33" cy="21" r="4.6" fill="#F4A940" stroke="#0E2A3A" stroke-width="2.2" />
</svg>
