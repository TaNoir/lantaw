<script lang="ts">
  // Opening a `.lantaw` backup: file + password, then "Open backup" decrypts
  // and validates it in memory (nothing is written yet), then the user picks
  // Merge or Replace. First run has nothing to merge into, and the sample
  // budget must never be mixed with real data, so both only offer Replace
  // ("Restore this backup"). Used by Settings and the first-run intro.
  import { onDestroy, tick } from 'svelte';
  import { app } from '../lib/state.svelte';
  import {
    BackupImportError,
    IMPORT_MESSAGES,
    MAX_FILE_CHARS,
    balanceUnreadable,
    importBackup,
    prepareImport,
    type BackupData,
  } from '../lib/backup';

  let {
    idPrefix,
    replaceOnly = false,
    onclose,
    ondone,
    onbusy,
  }: {
    /** Element ids start with this ("st-imp" -> "st-imp-file", "st-imp-pass", "st-imp-choice"). */
    idPrefix: string;
    /** First run (no local data) or the sample budget (never merged into): only Replace. */
    replaceOnly?: boolean;
    /** Cancel. The decrypted backup and the password are already cleared. */
    onclose: () => void;
    /** After a successful import, with a message to announce. */
    ondone: (message: string) => void;
    /** A decrypt or a save is running (the parent can ignore Escape meanwhile). */
    onbusy?: (busy: boolean) => void;
  } = $props();

  let file = $state<File | null>(null);
  let pass = $state('');
  let showPass = $state(false);
  let error = $state('');
  let busy = $state(false);
  /** The decrypted, validated backup, held only until Merge / Replace / Cancel. */
  let opened = $state.raw<BackupData | null>(null);

  const count = $derived(opened?.items.length ?? 0);
  const BALANCE_UNREADABLE = 'Your backup’s balance couldn’t be read — please check it in Settings.';
  const SAVE_FAILED = 'Couldn’t save on this device. Check that site data is allowed, then try again.';

  function setBusy(b: boolean) {
    busy = b;
    onbusy?.(b);
  }
  async function focusId(id: string) {
    await tick();
    document.getElementById(id)?.focus();
  }
  /** Lets the busy state paint before the synchronous Argon2 call blocks the page. */
  const nextPaint = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  function forget() {
    opened = null;
    pass = '';
    file = null;
  }
  onDestroy(forget);

  function cancel() {
    if (busy) return;
    forget();
    onclose();
  }

  function pickFile(e: Event & { currentTarget: HTMLInputElement }) {
    file = e.currentTarget.files?.[0] ?? null;
    error = '';
  }

  async function submitOpen(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    error = '';
    if (!file) {
      error = 'Choose a backup file.';
      return void focusId(`${idPrefix}-file`);
    }
    if (pass === '') {
      error = 'Enter the backup’s password.';
      return void focusId(`${idPrefix}-pass`);
    }
    setBusy(true);
    try {
      // Refuse an oversized file before reading it (2 bytes per char is the most text can need).
      if (file.size > MAX_FILE_CHARS * 2) throw new BackupImportError('NOT_LANTAW', 'too large');
      const text = await file.text();
      await nextPaint();
      // Everything is validated here; a failure leaves `opened` empty and storage untouched.
      opened = await importBackup(text, pass);
      pass = '';
      setBusy(false);
      void focusId(`${idPrefix}-choice`);
    } catch (err) {
      error = err instanceof BackupImportError ? IMPORT_MESSAGES[err.code] : 'Couldn’t read that file. Try again.';
      const wrongPass = err instanceof BackupImportError && err.code === 'WRONG_PASSPHRASE';
      void focusId(wrongPass ? `${idPrefix}-pass` : `${idPrefix}-file`);
    } finally {
      setBusy(false);
    }
  }

  async function apply(mode: 'replace' | 'merge') {
    if (!opened || busy) return;
    setBusy(true);
    try {
      const next = prepareImport(mode, app.backupData(), opened, app.today);
      // Replace with a balance that couldn't be read starts from ₱0 today: say so.
      const badBalance = mode === 'replace' && balanceUnreadable(opened);
      // From first run, the restored forecast shows on the Timeline.
      if (!app.settings.onboarded) app.navigate('timeline');
      await app.importData(next, { balanceUnreadable: badBalance });
      opened = null;
      const n = next.items.length;
      const items = `${n} ${n === 1 ? 'item' : 'items'}`;
      setBusy(false);
      const done = mode === 'merge' ? `Backup merged. ${items} on this device now.` : `Backup restored. ${items} on this device now.`;
      ondone(badBalance ? `${done} ${BALANCE_UNREADABLE}` : done);
    } catch {
      error = SAVE_FAILED;
    } finally {
      setBusy(false);
    }
  }
</script>

{#snippet err(text: string)}
  {#if text}
    <p class="err">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l6.5 12h-13z M8 6v3.5 M8 11.6v.1" /></svg>
      {text}
    </p>
  {/if}
{/snippet}

<div class="restore">
  {#if !opened}
    <form novalidate onsubmit={submitOpen}>
      <p class="lede">
        Open a <b>.lantaw</b> file made by Export. Nothing on this device changes until you choose what to do with it.
      </p>
      <div class="field">
        <label for="{idPrefix}-file">Backup file</label>
        <input id="{idPrefix}-file" class="file" type="file" accept=".lantaw,application/json" onchange={pickFile} />
      </div>
      <div class="field">
        <label for="{idPrefix}-pass">Backup password</label>
        <input
          id="{idPrefix}-pass"
          class="text"
          type={showPass ? 'text' : 'password'}
          autocomplete="off"
          bind:value={pass}
        />
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={showPass} />
        <span>Show password</span>
      </label>
      <div role="alert" class="status">{@render err(error)}</div>
      <div class="actions">
        <button type="submit" class="btn primary" aria-disabled={busy || undefined} aria-busy={busy || undefined}>
          {busy ? 'Opening…' : 'Open backup'}
        </button>
        <button type="button" class="btn ghost" onclick={cancel} aria-disabled={busy || undefined}>Cancel</button>
      </div>
    </form>
  {:else}
    <h3 id="{idPrefix}-choice" class="sub" tabindex="-1">Backup opened: {count} {count === 1 ? 'item' : 'items'}</h3>
    {#if replaceOnly}
      <p class="lede">
        {app.settings.isSample
          ? 'This replaces the sample budget with the backup’s balance, items and settings.'
          : 'This loads the backup’s balance, items and settings on this device.'}
      </p>
      <div class="actions">
        <button type="button" class="btn primary" aria-disabled={busy || undefined} aria-busy={busy || undefined} onclick={() => apply('replace')}>
          {busy ? 'Restoring…' : 'Restore this backup'}
        </button>
        <button type="button" class="btn ghost" onclick={cancel} aria-disabled={busy || undefined}>Cancel</button>
      </div>
    {:else}
      <p class="lede">Choose what to do with it.</p>
      <div class="choices">
        <div class="choice">
          <button type="button" class="btn primary" aria-disabled={busy || undefined} onclick={() => apply('merge')}>Merge</button>
          <p class="hint">Keeps your settings and adds the backup’s items. When both have the same item, the newer edit wins.</p>
        </div>
        <div class="choice">
          <button type="button" class="btn outline-danger" aria-disabled={busy || undefined} onclick={() => apply('replace')}>
            Replace everything
          </button>
          <p class="hint">Removes what’s on this device now and loads the backup’s balance, items and settings.</p>
        </div>
      </div>
      <div class="actions">
        <button type="button" class="btn ghost" onclick={cancel} aria-disabled={busy || undefined}>Cancel</button>
      </div>
    {/if}
    <div role="alert" class="status">{@render err(error)}</div>
  {/if}
</div>

<style>
  .restore,
  form {
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
  .field {
    display: grid;
    gap: 8px;
    min-width: 0;
  }
  label {
    font-size: 0.9375rem;
    font-weight: 700;
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
  }
  .text:focus-visible {
    outline: none;
    border-color: var(--teal);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--teal) 30%, transparent);
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
  .err {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--coral-text);
  }
  .err svg {
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
  .status:empty {
    display: none;
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
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
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
</style>
