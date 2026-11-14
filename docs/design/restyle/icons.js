// One stroke icon set for all three mockups (24px grid, round caps).
(function () {
  const P = {
    timeline: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/>',
    cutoffs: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18M8 14.5h3M13 14.5h3"/>',
    plans: '<path d="M5 21.5V3.5"/><path d="M5 4h12.5l-2.5 4 2.5 4H5"/>',
    kaya: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17v.01"/>',
    items: '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 14h5M9.5 8h5M17.5 16h5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
    pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
    gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M12 8v13M5.5 12v9h13v-9"/><path d="M12 8C10.5 4.5 6.5 4.2 6.5 6.3 6.5 8 10 8 12 8zM12 8c1.5-3.5 5.5-3.8 5.5-1.7C17.5 8 14 8 12 8z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.7c2 .7 3.1 2.4 3.5 5.3"/>',
    book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v15H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h14"/>',
    home: '<path d="M3 11l9-7.5 9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
    bolt: '<path d="M13.5 2.5L4.5 14h7l-1 7.5 9-11.5h-7z"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/>',
    basket: '<path d="M3.5 9.5h17l-1.6 10.5H5.1z"/><path d="M8 9.5l4-6 4 6M9.5 13.5v3M14.5 13.5v3"/>',
    peso: '<path d="M8 21V3.5h5a4.5 4.5 0 0 1 0 9H8"/><path d="M5 7h13M5 10h13"/>',
    wallet: '<path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4H5a2 2 0 0 0 0 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6"/><path d="M16 14h.01"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    left: '<path d="M14.5 6l-6 6 6 6"/>',
    right: '<path d="M9.5 6l6 6-6 6"/>',
    flag: '<path d="M5 21.5V3.5"/><path d="M5 4h12.5l-2.5 4 2.5 4H5"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  };
  window.icon = (name, size = 18, cls = '') =>
    `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
  window.LOGO = (size = 28) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#0E2A3A"/><path d="M8 47 L19 37 L25 40 L33 21 L38 24 L46 33 L56 29 L56 56 L8 56 Z" fill="#3FB8AF" opacity=".18"/><path d="M8 47 L19 37 L25 40 L33 21 L38 24 L46 33 L56 29" fill="none" stroke="#3FB8AF" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round"/><circle cx="33" cy="21" r="4.6" fill="#F4A940" stroke="#0E2A3A" stroke-width="2.2"/></svg>`;
})();
