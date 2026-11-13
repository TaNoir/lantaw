<script lang="ts">
  // Settings (gear icon): balance and forecast, holidays, foreign currency,
  // theme, encrypted backup, erase. Each row opens its editor inline, one at a
  // time; every write goes through `app` (plain data, then recompute).
  import { tick } from 'svelte';
  import Toggle from '../components/Toggle.svelte';
  import AlreadyInBalance from '../components/AlreadyInBalance.svelte';
  import { app } from '../lib/state.svelte';
  import { getCachedRate } from '../lib/apis';
  import {
    BackupImportError,
    IMPORT_MESSAGES,
    MAX_FILE_CHARS,
    exportBackup,
    importBackup,
    prepareImport,
    type BackupData,
  } from '../lib/backup';
  import type { EngineEvent, FxRate } from '../lib/engine-types';
  import { formatPeso, parseAmount, parseRate, toCentavos } from '../lib/money';
  import { formatDate, formatShort, yearOf } from '../lib/dates';
  import { currencySymbol } from '../lib/items';
  import { checklistRows, plainFromCentavos } from '../lib/onboarding';
  import {
    ERASE_WORD,
    PASSPHRASE_MIN,
    addCustomHoliday,
    checkAsOf,
    checkPassphrase,
    eraseConfirmed,
    formatRate,
    parseFeePct,
    rateCurrencies,
    removeCustomHoliday,
  } from '../lib/settings';
  import type { Theme } from '../lib/theme';
  import { version } from '../../package.json';

  const s = $derived(app.settings);
  const thisYear = $derived(yearOf(app.today));

  // ---- which editor is open (one at a time) ----
  type Key = 'balance' | 'buffer' | 'holidays' | 'fee' | `rate-${string}` | 'export' | 'import' | 'erase';
  let open = $state<Key | null>(null);

  async function focusId(id: string) {
    await tick();
    document.getElementById(id)?.focus();
  }
  function toggleEditor(key: Key, first: string) {
    if (open === key) return close();
    open = key;
    resetEditor(key);
    void focusId(first);
  }
  function close() {
    if (busy) return;
    const was = open;
    open = null;
    if (was) void focusId(`st-row-${was}`);
  }
  function onEditorKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !busy) {
      e.preventDefault();
      close();
    }
  }

  // ---- announcements ----
  let message = $state('');
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  function announce(text: string) {
    message = text;
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => (message = ''), 6000);
  }
  const SAVE_FAILED = 'Couldn’t save on this device. Check that site data is allowed, then try again.';

  /** A write is running (Argon2, a save): editors ignore Escape and double taps. */
  let busy = $state<string | null>(null);
  async function save(what: string, patch: Parameters<typeof app.updateSettings>[0], done?: string): Promise<boolean> {
    if (busy) return false;
    busy = what;
    try {
      await app.updateSettings(patch);
      if (done) announce(done);
      return true;
    } catch {
      announce(SAVE_FAILED);
      return false;
    } finally {
      busy = null;
    }
  }

  /** Radios (horizon, theme): saved at once, never blocked, so the checked radio always matches what's stored. */
  async function quickSave(patch: Parameters<typeof app.updateSettings>[0], done?: string) {
    try {
      await app.updateSettings(patch);
      if (done) announce(done);
    } catch {
      announce(SAVE_FAILED);
    }
  }

  // ---- per-editor form state ----
  let balRaw = $state('');
  let balAsOf = $state('');
  let balErr = $state('');
  let asOfErr = $state('');
  let balStep = $state<'edit' | 'check'>('edit');
  let due = $state.raw<EngineEvent[]>([]);
  let paid = $state<string[]>([]);
  let pending: { balance: string; balanceAsOf: string } | null = null;

  let bufRaw = $state('');
  let bufErr = $state('');
  let feeRaw = $state('');
  let feeErr = $state('');
  let holDate = $state('');
  let holName = $state('');
  let holErr = $state('');
  let rateRaw = $state('');
  let rateErr = $state('');

  let pass1 = $state('');
  let pass2 = $state('');
  let pass1Err = $state('');
  let pass2Err = $state('');
  let showPass = $state(false);
  let exportNote = $state('');
  let exportErr = $state('');

  let impFile = $state<File | null>(null);
  let impPass = $state('');
  let impErr = $state('');
  let impShowPass = $state(false);
  let opened = $state.raw<BackupData | null>(null);

  let eraseTyped = $state('');
  let eraseErr = $state('');

  const plain = (decimal: string) => plainFromCentavos(toCentavos(decimal));

  function resetEditor(key: Key) {
    if (key === 'balance') {
      balRaw = plain(s.balance);
      balAsOf = app.today;
      balErr = asOfErr = '';
      balStep = 'edit';
    } else if (key === 'buffer') {
      bufRaw = plain(s.safetyBuffer);
      bufErr = '';
    } else if (key === 'fee') {
      feeRaw = feeLabel(s.cardFxFeePct).replace('%', '');
      feeErr = '';
    } else if (key === 'holidays') {
      holDate = holName = holErr = '';
    } else if (key.startsWith('rate-')) {
      const r = rates[key.slice(5)];
      rateRaw = r ? formatRate(r.phpPerUnit) : '';
      rateErr = '';
    } else if (key === 'export') {
      pass1 = pass2 = pass1Err = pass2Err = exportNote = exportErr = '';
      showPass = false;
    } else if (key === 'import') {
      impFile = null;
      impPass = impErr = '';
      impShowPass = false;
      opened = null;
    } else if (key === 'erase') {
      eraseTyped = eraseErr = '';
    }
  }

  // ---- balance and as-of: saving goes through "Already in your balance?" ----
  async function submitBalance(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    const b = parseAmount(balRaw);
    balErr = b.ok ? '' : b.error;
    asOfErr = checkAsOf(balAsOf, app.today) ?? '';
    if (!b.ok || asOfErr) return void focusId(!b.ok ? 'st-balance' : 'st-asof');
    pending = { balance: b.value, balanceAsOf: balAsOf };
    busy = 'balance';
    try {
      const events = await app.dueOnAsOfFor({ ...s, ...pending }, app.items);
      const rows = checklistRows(events);
      if (rows.length > 0) {
        // Same as-of date: keep what was ticked before (if still listed).
        const before = balAsOf === s.balanceAsOf ? s.paidOnAsOf : [];
        paid = before.filter((id) => rows.some((r) => r.itemId === id));
        due = events;
        balStep = 'check';
        busy = null;
        return void focusId('st-check-h');
      }
      busy = null;
      await saveBalance([]);
    } catch {
      busy = null;
      announce(SAVE_FAILED);
    }
  }

  async function saveBalance(paidOnAsOf: string[]) {
    if (!pending || busy) return;
    const ok = await save('balance', { ...pending, paidOnAsOf: [...paidOnAsOf] }, 'Balance saved. Your forecast starts from it.');
    if (ok) close();
  }

  // ---- safety buffer, horizon ----
  async function submitBuffer(e: SubmitEvent) {
    e.preventDefault();
    const r = parseAmount(bufRaw);
    bufErr = r.ok ? '' : r.error;
    if (!r.ok) return void focusId('st-buffer');
    if (await save('buffer', { safetyBuffer: r.value }, `Safety buffer set to ${formatPeso(toCentavos(r.value))}.`)) close();
  }
  const HORIZONS = [12, 24] as const;
  function setHorizon(months: 12 | 24) {
    if (months !== s.horizonMonths) void quickSave({ horizonMonths: months }, `Looking ${months} months ahead.`);
  }

  // ---- holidays ----
  function setDavao(on: boolean) {
    void save('davao', { davaoHolidays: on }, on ? 'Davao City holidays are on.' : 'Davao City holidays are off.');
  }
  async function submitHoliday(e: SubmitEvent) {
    e.preventDefault();
    const r = addCustomHoliday(s, holDate, holName);
    if (!r.ok) {
      holErr = r.error;
      return void focusId('st-hol-date');
    }
    holErr = '';
    const label = formatDate(holDate);
    if (await save('holidays', r.patch, `${label} added as a holiday.`)) {
      holDate = holName = '';
      void focusId('st-hol-date');
    }
  }
  async function removeHoliday(date: string) {
    if (await save('holidays', removeCustomHoliday(s, date), `${formatDate(date)} removed.`)) void focusId('st-hol-date');
  }

  // ---- card fee and rates ----
  /** "2.50" -> "2.5%", "0" -> "0%". */
  function feeLabel(pct: string): string {
    const [w, f = ''] = pct.split('.');
    const frac = f.replace(/0+$/, '');
    return `${Number(w)}${frac ? `.${frac}` : ''}%`;
  }
  async function submitFee(e: SubmitEvent) {
    e.preventDefault();
    const r = parseFeePct(feeRaw);
    feeErr = r.ok ? '' : r.error;
    if (!r.ok) return void focusId('st-fee');
    if (await save('fee', { cardFxFeePct: r.value }, `Card FX fee set to ${feeLabel(r.value)}.`)) close();
  }

  const currencies = $derived(rateCurrencies(app.items));
  let rates = $state.raw<Record<string, FxRate | null>>({});
  $effect(() => {
    const curs = currencies;
    void app.projection; // re-read after each recompute, when a background refresh may have cached a rate
    let live = true;
    Promise.all(curs.map(async (c) => [c, await getCachedRate(c).catch(() => null)] as const)).then((pairs) => {
      if (live) rates = Object.fromEntries(pairs);
    });
    return () => {
      live = false;
    };
  });
  const rateKey = (cur: string): Key => `rate-${cur}`;
  function rateLabel(cur: string): string {
    const r = rates[cur];
    return r ? `₱${formatRate(r.phpPerUnit)} · ${formatShort(r.asOf, thisYear)}` : 'Not set';
  }

  let refreshing = $state<string | null>(null);
  async function refresh(cur: string) {
    if (refreshing) return;
    refreshing = cur;
    try {
      const out = await app.refreshRate(cur);
      rates = { ...rates, [cur]: out.rate };
      if (out.fresh && out.rate) {
        announce(`${cur} rate updated: ₱${formatRate(out.rate.phpPerUnit)} per ${currencySymbol(cur)}1 (${formatShort(out.rate.asOf, thisYear)}).`);
      } else {
        announce(
          out.rate
            ? `Couldn’t reach the rate service. Lantaw keeps the rate from ${formatShort(out.rate.asOf, thisYear)}.`
            : `Couldn’t reach the rate service. You can type the ${cur} rate in by hand.`,
        );
      }
    } catch {
      announce(SAVE_FAILED);
    } finally {
      refreshing = null;
    }
  }
  async function submitRate(e: SubmitEvent, cur: string) {
    e.preventDefault();
    if (busy) return;
    const r = parseRate(rateRaw);
    rateErr = r.ok ? '' : r.error;
    if (!r.ok) return void focusId(`st-rate-in-${cur}`);
    busy = 'rate';
    try {
      await app.saveManualRate(cur, r.value);
      rates = { ...rates, [cur]: await getCachedRate(cur) };
      announce(`${cur} rate set to ₱${formatRate(r.value)} by hand.`);
      busy = null;
      close();
    } catch {
      announce(SAVE_FAILED);
    } finally {
      busy = null;
    }
  }

  // ---- theme ----
  const THEMES: { id: Theme; label: string }[] = [
    { id: 'system', label: 'System' },
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
  ];
  function setTheme(t: Theme) {
    if (t !== s.theme) void quickSave({ theme: t });
  }

  // ---- export ----
  /** Lets the busy state paint before the synchronous Argon2 call blocks the page. */
  const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    // Revoked once the browser has started the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function submitExport(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    exportNote = exportErr = '';
    const c = checkPassphrase(pass1, pass2);
    pass1Err = c.first ?? '';
    pass2Err = c.second ?? '';
    if (c.first || c.second) return void focusId(c.first ? 'st-pass1' : 'st-pass2');
    busy = 'export';
    try {
      await nextPaint();
      const { filename, blob } = await exportBackup(app.backupData(), pass1);
      download(blob, filename);
      pass1 = pass2 = '';
      exportNote = `Saved ${filename}. Keep the file and its password somewhere safe.`;
      announce('Backup saved.');
    } catch {
      exportErr = 'Couldn’t make the backup. Try again.';
    } finally {
      busy = null;
    }
  }

  // ---- import: open (decrypt and check) first, then Replace or Merge ----
  function pickFile(e: Event & { currentTarget: HTMLInputElement }) {
    impFile = e.currentTarget.files?.[0] ?? null;
    impErr = '';
  }

  async function submitOpen(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    impErr = '';
    if (!impFile) {
      impErr = 'Choose a backup file.';
      return void focusId('st-imp-file');
    }
    if (impPass === '') {
      impErr = 'Enter the backup’s password.';
      return void focusId('st-imp-pass');
    }
    busy = 'import';
    try {
      // Refuse an oversized file before reading it (2 bytes per char is the most text can need).
      if (impFile.size > MAX_FILE_CHARS * 2) throw new BackupImportError('NOT_LANTAW', 'too large');
      const text = await impFile.text();
      await nextPaint();
      opened = await importBackup(text, impPass);
      impPass = '';
      busy = null;
      void focusId('st-imp-choice');
    } catch (err) {
      impErr = err instanceof BackupImportError ? IMPORT_MESSAGES[err.code] : 'Couldn’t read that file. Try again.';
      void focusId(err instanceof BackupImportError && err.code === 'WRONG_PASSPHRASE' ? 'st-imp-pass' : 'st-imp-file');
    } finally {
      busy = null;
    }
  }

  async function applyImport(mode: 'replace' | 'merge') {
    if (!opened || busy) return;
    busy = 'import';
    try {
      const next = prepareImport(mode, app.backupData(), opened, app.today);
      await app.importData(next);
      const n = next.items.length;
      announce(
        mode === 'replace'
          ? `Backup loaded. ${n} ${n === 1 ? 'item' : 'items'} on this device now.`
          : `Backup merged. ${n} ${n === 1 ? 'item' : 'items'} on this device now.`,
      );
      busy = null;
      close();
    } catch {
      impErr = SAVE_FAILED;
    } finally {
      busy = null;
    }
  }

  // ---- erase ----
  async function submitErase(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    if (!eraseConfirmed(eraseTyped)) {
      eraseErr = `Type ${ERASE_WORD} in capitals to confirm.`;
      return void focusId('st-erase');
    }
    busy = 'erase';
    try {
      await app.eraseEverything();
      // First run shows now; once it's done, start from the Timeline.
      app.navigate('timeline');
    } catch {
      eraseErr = 'Couldn’t erase everything. Reload the page and try again.';
    } finally {
      busy = null;
    }
  }

  const holidayCount = $derived(s.customHolidays.length);
  const openedCount = $derived(opened?.items.length ?? 0);
</script>

{#snippet err(id: string, text: string)}
  {#if text}
    <p class="err" id="{id}-err">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l6.5 12h-13z M8 6v3.5 M8 11.6v.1" /></svg>
      {text}
    </p>
  {/if}
{/snippet}

{#snippet rowBtn(key: Key, label: string, value: string, first: string, danger = false)}
  <button
    type="button"
    class="row-btn"
    class:danger
    id="st-row-{key}"
    aria-expanded={open === key}
    aria-controls="st-ed-{key}"
    onclick={() => toggleEditor(key, first)}
  >
    <span class="row-label">{label}</span>
    {#if value}<span class="row-value">{value}</span>{/if}
    <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6l-6 6" /></svg>
  </button>
{/snippet}

{#snippet lockIcon()}
  <svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 11h12v9.5h-12z M8.5 11V8a3.5 3.5 0 0 1 7 0v3" /></svg>
{/snippet}

<div class="page">
  <h1 tabindex="-1">Settings</h1>

  <div class="cols">
    <div class="col">
      <!-- ================= balance and forecast ================= -->
      <section class="card" aria-labelledby="st-h-money">
        <h2 id="st-h-money" class="kicker">Balance and forecast</h2>

        <div class="row-wrap">
          {@render rowBtn('balance', 'Balance', `${formatPeso(toCentavos(s.balance))} · ${formatShort(s.balanceAsOf, thisYear)}`, 'st-balance')}
          {#if open === 'balance'}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="editor" id="st-ed-balance" role="group" aria-label="Update your balance" onkeydown={onEditorKey}>
              {#if balStep === 'edit'}
                <form novalidate onsubmit={submitBalance}>
                  <p class="lede">All your money combined: GCash, Maya, bank and cash.</p>
                  <div class="field">
                    <label for="st-balance">Balance</label>
                    <div class="money" class:bad={!!balErr}>
                      <span aria-hidden="true">₱</span>
                      <input
                        id="st-balance"
                        inputmode="decimal"
                        autocomplete="off"
                        placeholder="0"
                        bind:value={balRaw}
                        aria-invalid={balErr ? 'true' : undefined}
                        aria-describedby={balErr ? 'st-balance-err' : undefined}
                      />
                    </div>
                    {@render err('st-balance', balErr)}
                  </div>
                  <div class="field">
                    <label for="st-asof">As of</label>
                    <input
                      id="st-asof"
                      class="text"
                      type="date"
                      max={app.today}
                      bind:value={balAsOf}
                      aria-invalid={asOfErr ? 'true' : undefined}
                      aria-describedby="st-asof-hint{asOfErr ? ' st-asof-err' : ''}"
                    />
                    <p class="hint" id="st-asof-hint">Usually today. Anything dated after it counts as still coming.</p>
                    {@render err('st-asof', asOfErr)}
                  </div>
                  <div class="actions">
                    <button type="submit" class="btn primary" aria-disabled={busy !== null || undefined} aria-busy={busy === 'balance' || undefined}>
                      {busy === 'balance' ? 'Checking…' : 'Save balance'}
                    </button>
                    <button type="button" class="btn ghost" onclick={close}>Cancel</button>
                  </div>
                </form>
              {:else}
                <h3 id="st-check-h" class="sub" tabindex="-1">Already in your balance?</h3>
                <p class="lede">
                  These are dated {balAsOf === app.today ? `today, ${formatShort(balAsOf, thisYear)}` : formatDate(balAsOf)}, the
                  day of your balance. Tick any that already came in or went out, so Lantaw doesn’t count them twice.
                </p>
                <AlreadyInBalance events={due} {paid} onchange={(next) => (paid = next)} />
                <p class="hint">Leave the rest unticked. Lantaw counts them as still coming.</p>
                <div class="actions">
                  <button
                    type="button"
                    class="btn primary"
                    onclick={() => saveBalance($state.snapshot(paid))}
                    aria-disabled={busy !== null || undefined}
                    aria-busy={busy === 'balance' || undefined}
                  >
                    {busy === 'balance' ? 'Saving…' : 'Save balance'}
                  </button>
                  <button
                    type="button"
                    class="btn ghost"
                    onclick={() => {
                      balStep = 'edit';
                      void focusId('st-balance');
                    }}>Back</button
                  >
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <div class="row-wrap">
          {@render rowBtn('buffer', 'Safety buffer', formatPeso(toCentavos(s.safetyBuffer)), 'st-buffer')}
          {#if open === 'buffer'}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="editor" id="st-ed-buffer" role="group" aria-label="Safety buffer" onkeydown={onEditorKey}>
              <form novalidate onsubmit={submitBuffer}>
                <div class="field">
                  <label for="st-buffer">Safety buffer</label>
                  <div class="money small" class:bad={!!bufErr}>
                    <span aria-hidden="true">₱</span>
                    <input
                      id="st-buffer"
                      inputmode="decimal"
                      autocomplete="off"
                      bind:value={bufRaw}
                      aria-invalid={bufErr ? 'true' : undefined}
                      aria-describedby="st-buffer-hint{bufErr ? ' st-buffer-err' : ''}"
                    />
                  </div>
                  <p class="hint" id="st-buffer-hint">Lantaw warns you on days your balance would drop below this.</p>
                  {@render err('st-buffer', bufErr)}
                </div>
                <div class="actions">
                  <button type="submit" class="btn primary" aria-disabled={busy !== null || undefined}>Save</button>
                  <button type="button" class="btn ghost" onclick={close}>Cancel</button>
                </div>
              </form>
            </div>
          {/if}
        </div>

        <div class="row-wrap seg-row" role="radiogroup" aria-labelledby="st-horizon-l">
          <span class="row-label" id="st-horizon-l">Look ahead</span>
          <div class="seg">
            {#each HORIZONS as m (m)}
              <label class="seg-opt">
                <input
                  type="radio"
                  name="st-horizon"
                  value={m}
                  checked={s.horizonMonths === m}
                  onchange={() => setHorizon(m)}
                />
                <span>{m} months</span>
              </label>
            {/each}
          </div>
        </div>
      </section>

      <!-- ================= holidays ================= -->
      <section class="card" aria-labelledby="st-h-hol">
        <h2 id="st-h-hol" class="kicker">Holidays</h2>
        <div class="row-wrap toggle-row">
          <div class="toggle-text">
            <span class="row-label" id="st-davao-l">Davao City holidays</span>
            <span class="hint" id="st-davao-h">Araw ng Davao, March 16</span>
          </div>
          <Toggle
            checked={s.davaoHolidays}
            onchange={setDavao}
            labelledby="st-davao-l"
            describedby="st-davao-h"
            busy={busy === 'davao'}
          />
        </div>

        <div class="row-wrap">
          {@render rowBtn('holidays', 'My own holidays', holidayCount === 0 ? 'None' : String(holidayCount), 'st-hol-date')}
          {#if open === 'holidays'}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="editor" id="st-ed-holidays" role="group" aria-label="My own holidays" onkeydown={onEditorKey}>
              <p class="lede">
                Add days off that are announced late, like a special non-working day. Paydays and bills that move to a working
                day will move around them too.
              </p>
              {#if holidayCount > 0}
                <ul class="hol-list" aria-label="Your holidays">
                  {#each s.customHolidays as d (d)}
                    <li>
                      <span class="hol-text">
                        <span class="hol-date">{formatDate(d)}</span>
                        {#if s.holidayNames?.[d]}<span class="hint">{s.holidayNames[d]}</span>{/if}
                      </span>
                      <button
                        type="button"
                        class="text-btn danger"
                        aria-label="Remove {formatDate(d)}"
                        aria-disabled={busy !== null || undefined}
                        onclick={() => removeHoliday(d)}>Remove</button
                      >
                    </li>
                  {/each}
                </ul>
              {/if}
              <form class="hol-form" novalidate onsubmit={submitHoliday}>
                <div class="field">
                  <label for="st-hol-date">Date</label>
                  <input
                    id="st-hol-date"
                    class="text"
                    type="date"
                    bind:value={holDate}
                    aria-invalid={holErr ? 'true' : undefined}
                    aria-describedby={holErr ? 'st-hol-date-err' : undefined}
                  />
                </div>
                <div class="field">
                  <label for="st-hol-name">Name <span class="opt">(optional)</span></label>
                  <input id="st-hol-name" class="text" maxlength="40" autocomplete="off" bind:value={holName} />
                </div>
                {@render err('st-hol-date', holErr)}
                <div class="actions">
                  <button type="submit" class="btn primary" aria-disabled={busy !== null || undefined}>Add holiday</button>
                  <button type="button" class="btn ghost" onclick={close}>Done</button>
                </div>
              </form>
            </div>
          {/if}
        </div>
      </section>

      <!-- ================= foreign currency ================= -->
      <section class="card" aria-labelledby="st-h-fx">
        <h2 id="st-h-fx" class="kicker">Foreign currency</h2>
        <div class="row-wrap">
          {@render rowBtn('fee', 'Card FX fee', feeLabel(s.cardFxFeePct), 'st-fee')}
          {#if open === 'fee'}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="editor" id="st-ed-fee" role="group" aria-label="Card FX fee" onkeydown={onEditorKey}>
              <form novalidate onsubmit={submitFee}>
                <div class="field">
                  <label for="st-fee">Card foreign-transaction fee</label>
                  <div class="money small pct" class:bad={!!feeErr}>
                    <input
                      id="st-fee"
                      inputmode="decimal"
                      autocomplete="off"
                      bind:value={feeRaw}
                      aria-invalid={feeErr ? 'true' : undefined}
                      aria-describedby="st-fee-hint{feeErr ? ' st-fee-err' : ''}"
                    />
                    <span aria-hidden="true">%</span>
                  </div>
                  <p class="hint" id="st-fee-hint">
                    Added on top of foreign-currency items. Many PH cards charge 2 to 3.5%. From 0 to 10.
                  </p>
                  {@render err('st-fee', feeErr)}
                </div>
                <div class="actions">
                  <button type="submit" class="btn primary" aria-disabled={busy !== null || undefined}>Save</button>
                  <button type="button" class="btn ghost" onclick={close}>Cancel</button>
                </div>
              </form>
            </div>
          {/if}
        </div>

        {#each currencies as cur (cur)}
          {@const key = rateKey(cur)}
          <div class="row-wrap">
            <div class="rate-row">
              {@render rowBtn(key, `${cur} rate`, rateLabel(cur), `st-rate-in-${cur}`)}
              <button
                type="button"
                class="icon-btn"
                aria-label="Refresh the {cur} rate"
                aria-busy={refreshing === cur || undefined}
                aria-disabled={refreshing !== null || undefined}
                onclick={() => refresh(cur)}
              >
                <svg class:spin={refreshing === cur} viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3 M19.5 4.5v4h-4" />
                </svg>
              </button>
            </div>
            {#if open === key}
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <div class="editor" id="st-ed-{key}" role="group" aria-label="{cur} rate" onkeydown={onEditorKey}>
                <form novalidate onsubmit={(e) => submitRate(e, cur)}>
                  <div class="field">
                    <label for="st-rate-in-{cur}">Pesos per {currencySymbol(cur)}1</label>
                    <div class="money small" class:bad={!!rateErr}>
                      <span aria-hidden="true">₱</span>
                      <input
                        id="st-rate-in-{cur}"
                        inputmode="decimal"
                        autocomplete="off"
                        bind:value={rateRaw}
                        aria-invalid={rateErr ? 'true' : undefined}
                        aria-describedby="st-rate-hint-{cur}{rateErr ? ` st-rate-in-${cur}-err` : ''}"
                      />
                    </div>
                    <p class="hint" id="st-rate-hint-{cur}">
                      Type it in when you’re offline or want your card’s rate. The refresh button gets the latest one.
                    </p>
                    {@render err(`st-rate-in-${cur}`, rateErr)}
                  </div>
                  <div class="actions">
                    <button type="submit" class="btn primary" aria-disabled={busy !== null || undefined}>Save rate</button>
                    <button type="button" class="btn ghost" onclick={close}>Cancel</button>
                  </div>
                </form>
              </div>
            {/if}
          </div>
        {/each}
      </section>
    </div>

    <div class="col">
      <!-- ================= theme ================= -->
      <section class="card" aria-labelledby="st-h-theme">
        <h2 id="st-h-theme" class="kicker">Theme</h2>
        <div class="row-wrap seg-row" role="radiogroup" aria-labelledby="st-h-theme">
          <div class="seg">
            {#each THEMES as t (t.id)}
              <label class="seg-opt">
                <input type="radio" name="st-theme" value={t.id} checked={s.theme === t.id} onchange={() => setTheme(t.id)} />
                <span>{t.label}</span>
              </label>
            {/each}
          </div>
        </div>
      </section>

      <!-- ================= your data ================= -->
      <section class="card" aria-labelledby="st-h-data">
        <h2 id="st-h-data" class="kicker">Your data</h2>

        <div class="row-wrap">
          {@render rowBtn('export', 'Export encrypted backup', '', 'st-pass1')}
          {#if open === 'export'}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="editor" id="st-ed-export" role="group" aria-label="Export encrypted backup" onkeydown={onEditorKey}>
              <form novalidate onsubmit={submitExport}>
                <p class="lede">
                  Saves your balance, items and settings in one file, locked with a password you choose. Use it to move to a new
                  phone or to keep a copy.
                </p>
                <p class="warn" id="st-pass-warn">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l6.5 12h-13z M8 6v3.5 M8 11.6v.1" /></svg>
                  If you forget this password, the backup can’t be opened.
                </p>
                <div class="field">
                  <label for="st-pass1">Password</label>
                  <input
                    id="st-pass1"
                    class="text"
                    type={showPass ? 'text' : 'password'}
                    autocomplete="new-password"
                    bind:value={pass1}
                    aria-invalid={pass1Err ? 'true' : undefined}
                    aria-describedby="st-pass1-hint st-pass-warn{pass1Err ? ' st-pass1-err' : ''}"
                  />
                  <p class="hint" id="st-pass1-hint">At least {PASSPHRASE_MIN} characters. A short sentence is easy to remember.</p>
                  {@render err('st-pass1', pass1Err)}
                </div>
                <div class="field">
                  <label for="st-pass2">Type it again</label>
                  <input
                    id="st-pass2"
                    class="text"
                    type={showPass ? 'text' : 'password'}
                    autocomplete="new-password"
                    bind:value={pass2}
                    aria-invalid={pass2Err ? 'true' : undefined}
                    aria-describedby={pass2Err ? 'st-pass2-err' : undefined}
                  />
                  {@render err('st-pass2', pass2Err)}
                </div>
                <label class="check">
                  <input type="checkbox" bind:checked={showPass} />
                  <span>Show password</span>
                </label>
                {@render err('st-export', exportErr)}
                <div class="actions">
                  <button type="submit" class="btn primary" aria-disabled={busy !== null || undefined} aria-busy={busy === 'export' || undefined}>
                    {busy === 'export' ? 'Locking your backup…' : 'Export backup'}
                  </button>
                  <button type="button" class="btn ghost" onclick={close} aria-disabled={busy === 'export' || undefined}>Close</button>
                </div>
                <div role="status" class="status">
                  {#if exportNote}
                    <p class="ok">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                      {exportNote}
                    </p>
                  {/if}
                </div>
              </form>
            </div>
          {/if}
        </div>

        <div class="row-wrap">
          {@render rowBtn('import', 'Import backup', '', 'st-imp-file')}
          {#if open === 'import'}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="editor" id="st-ed-import" role="group" aria-label="Import backup" onkeydown={onEditorKey}>
              {#if !opened}
                <form novalidate onsubmit={submitOpen}>
                  <p class="lede">Open a <b>.lantaw</b> file made by Export. Nothing on this device changes until you choose below.</p>
                  <div class="field">
                    <label for="st-imp-file">Backup file</label>
                    <input
                      id="st-imp-file"
                      class="file"
                      type="file"
                      accept=".lantaw,application/json"
                      onchange={pickFile}
                    />
                  </div>
                  <div class="field">
                    <label for="st-imp-pass">Backup password</label>
                    <input
                      id="st-imp-pass"
                      class="text"
                      type={impShowPass ? 'text' : 'password'}
                      autocomplete="off"
                      bind:value={impPass}
                    />
                  </div>
                  <label class="check">
                    <input type="checkbox" bind:checked={impShowPass} />
                    <span>Show password</span>
                  </label>
                  <div role="alert" class="status">{@render err('st-imp', impErr)}</div>
                  <div class="actions">
                    <button type="submit" class="btn primary" aria-disabled={busy !== null || undefined} aria-busy={busy === 'import' || undefined}>
                      {busy === 'import' ? 'Opening…' : 'Open backup'}
                    </button>
                    <button type="button" class="btn ghost" onclick={close}>Cancel</button>
                  </div>
                </form>
              {:else}
                <h3 id="st-imp-choice" class="sub" tabindex="-1">
                  Backup opened: {openedCount} {openedCount === 1 ? 'item' : 'items'}
                </h3>
                <p class="lede">Choose what to do with it.</p>
                <div class="choices">
                  <div class="choice">
                    <button type="button" class="btn primary" aria-disabled={busy !== null || undefined} onclick={() => applyImport('merge')}>
                      Merge
                    </button>
                    <p class="hint">
                      Keeps your settings and adds the backup’s items. When both have the same item, the newer edit wins.
                    </p>
                  </div>
                  <div class="choice">
                    <button type="button" class="btn outline-danger" aria-disabled={busy !== null || undefined} onclick={() => applyImport('replace')}>
                      Replace everything
                    </button>
                    <p class="hint">Removes what’s on this device now and loads the backup’s balance, items and settings.</p>
                  </div>
                </div>
                <div role="alert" class="status">{@render err('st-imp2', impErr)}</div>
                <div class="actions">
                  <button type="button" class="btn ghost" onclick={close} aria-disabled={busy !== null || undefined}>Cancel</button>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <div class="row-wrap">
          {@render rowBtn('erase', 'Erase everything', '', 'st-erase', true)}
          {#if open === 'erase'}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div class="editor" id="st-ed-erase" role="group" aria-label="Erase everything" onkeydown={onEditorKey}>
              <form novalidate onsubmit={submitErase}>
                <p class="lede">
                  Deletes your balance, items, settings and saved rates from this device. This can’t be undone. Export a backup
                  first if you might want them back.
                </p>
                <div class="field">
                  <label for="st-erase">Type <b>{ERASE_WORD}</b> to confirm</label>
                  <input
                    id="st-erase"
                    class="text"
                    autocomplete="off"
                    autocapitalize="characters"
                    spellcheck="false"
                    bind:value={eraseTyped}
                    aria-invalid={eraseErr ? 'true' : undefined}
                    aria-describedby={eraseErr ? 'st-erase-err' : undefined}
                  />
                  {@render err('st-erase', eraseErr)}
                </div>
                <div class="actions">
                  <button type="submit" class="btn outline-danger" aria-disabled={busy !== null || undefined}>Erase everything</button>
                  <button type="button" class="btn ghost" onclick={close}>Cancel</button>
                </div>
              </form>
            </div>
          {/if}
        </div>
      </section>

      <!-- ================= about ================= -->
      <footer class="about">
        <p class="private">{@render lockIcon()} Stored only on this device</p>
        <p>Lantaw {version}. No account, no tracking. Only holiday dates and exchange rates come from the internet.</p>
        <p>Lantaw is Bisaya for ‘to look out into the distance.’</p>
      </footer>
    </div>
  </div>
</div>

<p class="sr-only" role="status" aria-live="polite">{message}</p>
{#if message}
  <div class="toast" aria-hidden="true">{message}</div>
{/if}

<style>
  .page {
    max-width: 40rem;
    padding: 12px 16px 24px;
  }
  @media (min-width: 1024px) {
    .page {
      max-width: 72rem;
      padding: 32px;
    }
  }
  h1 {
    margin: 0 0 12px;
    font-size: 1.75rem;
    font-weight: 800;
    letter-spacing: -0.03em;
  }
  h1:focus {
    outline: none;
  }

  .cols {
    display: grid;
    gap: 14px;
    align-items: start;
  }
  .col {
    display: grid;
    gap: 14px;
    min-width: 0;
  }
  @media (min-width: 1100px) {
    .cols {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 20px;
    }
    .col {
      gap: 20px;
    }
  }

  .card {
    min-width: 0;
    padding: 14px 16px 6px;
    border-radius: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .kicker {
    margin: 0 0 2px;
    font-size: 0.875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--muted);
  }

  /* ---------- rows ---------- */
  .row-wrap {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    border-top: 1px solid var(--border);
  }
  .kicker + .row-wrap {
    border-top: 0;
  }
  .row-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 56px;
    padding: 10px 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row-label {
    flex: 1;
    min-width: 0;
    font-size: 1rem;
    font-weight: 700;
  }
  .row-value {
    flex: none;
    max-width: 60%;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    text-align: right;
    overflow-wrap: anywhere;
  }
  .chev {
    flex: none;
    width: 20px;
    height: 20px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 180ms cubic-bezier(0.3, 0.7, 0.4, 1);
  }
  .row-btn[aria-expanded='true'] .chev {
    transform: rotate(90deg);
  }
  .row-btn:hover .row-label {
    color: var(--teal-text);
  }
  .row-btn:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: -2px;
    border-radius: 10px;
  }
  .row-btn.danger .row-label,
  .row-btn.danger:hover .row-label {
    color: var(--coral-text);
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 64px;
    padding: 8px 0;
  }
  .toggle-text {
    display: grid;
    flex: 1;
    min-width: 0;
  }

  .seg-row .row-label {
    flex: 1 0 auto;
    white-space: nowrap;
  }
  .seg-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
    padding: 10px 0 12px;
  }
  .seg {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .seg-opt {
    position: relative;
    margin: 0;
  }
  .seg-opt input {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
    cursor: pointer;
  }
  .seg-opt span {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 8px 16px;
    border: 1.5px solid var(--border);
    border-radius: 99px;
    background: var(--bg);
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--text);
    transition:
      border-color 140ms ease-out,
      background-color 140ms ease-out;
  }
  .seg-opt:hover span {
    border-color: color-mix(in srgb, var(--muted) 60%, var(--border));
  }
  .seg-opt input:checked + span {
    border-color: var(--teal);
    background: color-mix(in srgb, var(--teal) 16%, var(--bg));
    color: var(--teal-text);
  }
  .seg-opt input:focus-visible + span {
    outline: 2px solid var(--teal);
    outline-offset: 2px;
  }

  .rate-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .rate-row :global(.row-btn) {
    flex: 1;
    min-width: 0;
  }
  .icon-btn {
    display: grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    border: 1.5px solid var(--border);
    border-radius: 12px;
    background: var(--surface-2);
    color: var(--teal-text);
    cursor: pointer;
  }
  .icon-btn:hover {
    border-color: var(--teal);
  }
  .icon-btn[aria-disabled='true'] {
    cursor: progress;
  }
  .icon-btn svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .spin {
    animation: spin 900ms linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ---------- editors ---------- */
  .editor {
    display: grid;
    gap: 14px;
    margin: 0 0 14px;
    padding: 14px;
    border-radius: 14px;
    background: var(--surface-2);
  }
  .editor form {
    display: grid;
    gap: 14px;
    min-width: 0;
  }
  .sub {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 800;
    letter-spacing: -0.01em;
  }
  .sub:focus {
    outline: none;
  }
  .lede {
    margin: 0;
    color: var(--text);
    text-wrap: pretty;
  }
  .hint {
    margin: 0;
    font-size: 0.875rem;
    color: var(--muted);
    text-wrap: pretty;
  }
  .opt {
    font-weight: 600;
    color: var(--muted);
  }
  .field {
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  label {
    font-size: 0.9375rem;
    font-weight: 700;
  }
  .money {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    gap: 6px;
    min-height: 60px;
    padding: 0 16px;
    border-radius: 14px;
    border: 1.5px solid var(--border);
    background: var(--surface);
    font-size: 1.75rem;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .money.small {
    min-height: 52px;
    font-size: 1.375rem;
  }
  .money span {
    color: var(--muted);
  }
  .money input {
    flex: 1 1 0;
    width: 100%;
    min-width: 0;
    padding: 8px 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    font-variant-numeric: tabular-nums;
  }
  .money input::placeholder {
    color: var(--muted);
  }
  .money input:focus {
    outline: none;
  }
  .money:focus-within {
    border-color: var(--teal);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--teal) 30%, transparent);
  }
  .money.bad {
    border-color: var(--coral);
  }
  .text {
    display: block;
    width: 100%;
    min-width: 0;
    min-height: 48px;
    padding: 10px 14px;
    border-radius: 12px;
    border: 1.5px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 1rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .text:focus-visible {
    outline: none;
    border-color: var(--teal);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--teal) 30%, transparent);
  }
  .text[aria-invalid='true'] {
    border-color: var(--coral);
  }
  .file {
    width: 100%;
    min-width: 0;
    color: var(--text);
    font: inherit;
    font-size: 0.9375rem;
  }
  .file::file-selector-button {
    min-height: 44px;
    margin-right: 12px;
    padding: 8px 16px;
    border: 1.5px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .file:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: 2px;
    border-radius: 12px;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    font-weight: 600;
    cursor: pointer;
  }
  .check input {
    width: 20px;
    height: 20px;
    margin: 0;
    accent-color: var(--teal);
  }

  .err,
  .warn,
  .ok {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
  }
  .err {
    font-size: 0.875rem;
    color: var(--coral-text);
  }
  .warn {
    padding: 10px 12px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--mango) 14%, var(--surface));
    color: var(--text);
  }
  .ok {
    color: var(--teal-text);
  }
  .err svg,
  .warn svg,
  .ok svg {
    flex: none;
    width: 16px;
    height: 16px;
    margin-top: 3px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .warn svg {
    stroke: var(--mango);
    stroke-width: 2;
  }
  .ok svg {
    stroke-width: 2.6;
  }
  .status:empty {
    display: none;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 44px;
    padding: 10px 18px;
    border: 1.5px solid transparent;
    border-radius: 12px;
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 800;
    cursor: pointer;
    transition:
      transform 120ms ease-out,
      background-color 160ms ease-out;
  }
  .btn:active {
    transform: scale(0.97);
  }
  .btn[aria-disabled='true'] {
    cursor: progress;
  }
  .btn.primary {
    background: var(--mango);
    color: var(--on-mango);
  }
  .btn.primary:hover {
    background: color-mix(in srgb, var(--mango) 88%, var(--text));
  }
  .btn.ghost {
    background: transparent;
    border-color: var(--border);
    color: var(--text);
  }
  .btn.ghost:hover {
    background: var(--surface);
  }
  .btn.outline-danger {
    background: var(--surface);
    border-color: var(--coral);
    color: var(--coral-text);
  }
  .btn.outline-danger:hover {
    background: color-mix(in srgb, var(--coral) 10%, var(--surface));
  }
  .text-btn {
    min-height: 44px;
    padding: 8px 12px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--teal-text);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .text-btn.danger {
    color: var(--coral-text);
  }
  .text-btn:hover {
    background: var(--surface);
  }

  .hol-list {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .hol-list li {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 52px;
    padding: 4px 4px 4px 14px;
    border-radius: 12px;
    background: var(--surface);
  }
  .hol-text {
    display: grid;
    flex: 1;
    min-width: 0;
  }
  .hol-date {
    font-weight: 700;
  }
  .hol-text .hint {
    overflow-wrap: anywhere;
  }

  .choices {
    display: grid;
    gap: 14px;
  }
  .choice {
    display: grid;
    justify-items: start;
    gap: 6px;
  }

  .about {
    display: grid;
    gap: 6px;
    padding: 8px 4px 0;
    text-align: center;
  }
  .about p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--muted);
    text-wrap: pretty;
  }
  .about .private {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--text);
  }
  .lock {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: var(--teal-text);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(88px + env(safe-area-inset-bottom));
    z-index: 40;
    max-width: calc(100% - 32px);
    padding: 10px 16px;
    border-radius: 12px;
    background: var(--text);
    color: var(--bg);
    font-size: 0.9375rem;
    font-weight: 700;
    transform: translateX(-50%);
    box-shadow: 0 8px 24px rgb(3 12 18 / 0.35);
    animation: toast-in 200ms ease-out;
  }
  @keyframes toast-in {
    from {
      transform: translate(-50%, 8px);
    }
  }
  @media (min-width: 1024px) {
    .toast {
      bottom: 24px;
      left: calc(50% + 116px);
    }
  }
</style>
