<script lang="ts">
  // The far mountains behind the forecast ridge: a static, authored silhouette of
  // the Mt. Apo range (its twin summit sits right of centre). Colours come from
  // the theme tokens, so night and day share one drawing.
  const uid = $props.id();
</script>

<svg class="range" viewBox="0 0 1440 600" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="{uid}-far" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="far-top" />
      <stop offset="1" class="far-bottom" />
    </linearGradient>
    <linearGradient id="{uid}-mid" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="mid-top" />
      <stop offset="1" class="mid-bottom" />
    </linearGradient>
    <linearGradient id="{uid}-haze" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="haze" stop-opacity="0" />
      <stop offset="1" class="haze" stop-opacity="0.55" />
    </linearGradient>
  </defs>
  <path
    class="far"
    fill="url(#{uid}-far)"
    d="M0 392 C90 380 150 360 230 352 C320 342 380 330 450 318 C520 304 570 286 640 262 C690 246 720 226 752 214 L770 206 L786 218 L806 200 L824 196 L842 212 C880 236 930 252 990 270 C1060 290 1120 300 1190 318 C1270 338 1350 350 1440 362 L1440 600 L0 600 Z"
  />
  <rect x="0" y="300" width="1440" height="140" fill="url(#{uid}-haze)" />
  <path
    fill="url(#{uid}-mid)"
    d="M0 430 C80 420 140 398 210 392 C290 384 340 404 420 396 C500 388 560 356 640 350 C720 344 770 372 850 368 C940 364 990 334 1070 330 C1150 326 1220 358 1300 362 C1360 365 1400 360 1440 356 L1440 600 L0 600 Z"
  />
</svg>

<style>
  .range {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
  }
  .far {
    opacity: var(--range-far-opacity);
  }
  .far-top {
    stop-color: var(--range-far-top);
  }
  .far-bottom {
    stop-color: var(--range-far-bottom);
  }
  .mid-top {
    stop-color: var(--range-mid-top);
  }
  .mid-bottom {
    stop-color: var(--range-mid-bottom);
  }
  .haze {
    stop-color: var(--haze);
  }
</style>
