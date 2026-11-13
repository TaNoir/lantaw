<script lang="ts">
  // First run: intro -> balance -> sweldo -> quick add -> (Already in your
  // balance?) -> Timeline. Or intro -> restore a backup -> Timeline. Everything typed stays in memory until the end;
  // only items added from the quick-add chips are saved along the way (the
  // ItemEditor saves them itself).
  import { tick } from 'svelte';
  import Logo from '../components/Logo.svelte';
  import Toggle from '../components/Toggle.svelte';
  import ItemEditor from '../components/ItemEditor.svelte';
  import AlreadyInBalance from '../components/AlreadyInBalance.svelte';
  import RestoreBackup from '../components/RestoreBackup.svelte';
  import { app } from '../lib/state.svelte';
  import type { EngineEvent } from '../lib/engine-types';
  import type { StoredItem } from '../lib/db';
  import { formatPeso, parseAmount, toCentavos } from '../lib/money';
  import { formatDate, formatShort, weekday, yearOf } from '../lib/dates';
  import { ordinal } from '../lib/cutoff';
  import { PRESETS, formFromItem, isIsoDate, presetItem, type ItemForm } from '../lib/items';
  import {
    QUICK_GROUPS,
    SWELDO_SCHEDULES,
    blankSweldo,
    buildSweldoItems,
    checklistRows,
    defaultThirteenth,
    firstRunWrites,
    monthlyPayCentavos,
    type SweldoErrors,
    type SweldoForm,
  } from '../lib/onboarding';

  type Step = 'intro' | 'restore' | 'balance' | 'sweldo' | 'quick' | 'check';
  const NUMBERED: Partial<Record<Step, number>> = { balance: 1, sweldo: 2, quick: 3 };

  let step = $state<Step>('intro');
  let busy = $state<'start' | 'sample' | 'finish' | null>(null);
  let failure = $state('');
  const thisYear = $derived(yearOf(app.today));

  async function go(next: Step) {
    step = next;
    failure = '';
    await tick();
    window.scrollTo(0, 0);
    document.getElementById('fr-title')?.focus({ preventScroll: true });
  }

  // ---- intro ----
  /** Start: drop anything left from an unfinished first run, then ask for the balance. */
  async function start() {
    if (busy) return;
    busy = 'start';
    failure = '';
    try {
      await app.startFirstRun();
      added = {};
      paid = [];
      busy = null;
      await go('balance');
    } catch {
      failure = 'Couldn’t open storage on this device. Check that site data is allowed, then try again.';
    } finally {
      busy = null;
    }
  }

  async function trySample() {
    if (busy) return;
    busy = 'sample';
    failure = '';
    try {
      app.navigate('timeline');
      await app.loadSample();
    } catch {
      failure = 'Couldn’t load the sample on this device. Check that site data is allowed, then try again.';
    } finally {
      busy = null;
    }
  }

  // ---- step 1: balance ----
  let balanceRaw = $state('');
  let asOf = $state(app.today);
  let balanceTried = $state(false);
  const balance = $derived(parseAmount(balanceRaw));
  const balanceError = $derived(
    !balanceTried || balance.ok
      ? ''
      : balanceRaw.trim() === ''
        ? 'Enter your balance. If it’s empty, type 0.'
        : balance.error,
  );
  const asOfError = $derived(
    !balanceTried
      ? ''
      : !isIsoDate(asOf)
        ? 'Pick the date of this balance.'
        : asOf > app.today
          ? 'Pick today or an earlier day.'
          : '',
  );

  function submitBalance(e: SubmitEvent) {
    e.preventDefault();
    balanceTried = true;
    if (!balance.ok) document.getElementById('fr-balance')?.focus();
    else if (asOfError) document.getElementById('fr-asof')?.focus();
    else {
      // Weekly paydays default to the balance's date until the user picks one.
      if (!nextPaydayTouched) sweldo.nextPayday = asOf;
      void go('sweldo');
    }
  }

  // ---- step 2: sweldo ----
  let sweldo = $state<SweldoForm>(blankSweldo(app.today));
  let sweldoTried = $state(false);
  let thirteenthTouched = $state(false);
  let nextPaydayTouched = false;
  /** False when the sweldo step was skipped ("I don't have a regular sweldo"). */
  let withSweldo = false;

  const built = $derived(buildSweldoItems(sweldo, asOf, []));
  const sweldoErrors = $derived<SweldoErrors>(sweldoTried && !built.ok ? built.errors : {});
  const isWeekly = $derived(sweldo.schedule === 'weekly' || sweldo.schedule === 'everyTwoWeeks');

  // The 13th month follows "one month's pay" until the user types their own.
  $effect(() => {
    const d = defaultThirteenth(sweldo.amount, sweldo.schedule);
    if (!thirteenthTouched) sweldo.thirteenthAmount = d;
  });

  /** Typing marks the 13th month as the user's own; an emptied field goes back to the default when left. */
  function blurThirteenth() {
    if (sweldo.thirteenthAmount.trim() !== '') return;
    thirteenthTouched = false;
    sweldo.thirteenthAmount = defaultThirteenth(sweldo.amount, sweldo.schedule);
  }

  const monthlyHint = $derived.by(() => {
    const a = parseAmount(sweldo.amount);
    if (!a.ok || toCentavos(a.value) === 0) return '';
    const m = monthlyPayCentavos(toCentavos(a.value), sweldo.schedule);
    if (sweldo.schedule === 'monthly') return '';
    return `${isWeekly ? 'About' : 'That’s'} ${formatPeso(m)} a month.`;
  });

  const DAYS = Array.from({ length: 31 }, (_, n) => n + 1);

  function submitSweldo(e: SubmitEvent) {
    e.preventDefault();
    sweldoTried = true;
    if (!built.ok) {
      const order = ['amount', 'payDay', 'nextPayday', 'thirteenthAmount'] as const;
      const first = order.find((k) => built.ok === false && built.errors[k]);
      if (first) document.getElementById(`fr-${first}`)?.focus();
      return;
    }
    withSweldo = true;
    void go('quick');
  }

  function skipSweldo() {
    withSweldo = false;
    void go('quick');
  }

  // ---- step 3: quick add ----
  /** Preset key -> the id of the item saved from it. */
  let added = $state<Record<string, string>>({});
  let editor = $state<{ form: ItemForm; isNew: boolean; key: number } | null>(null);
  let opener: HTMLElement | null = null;
  let openedFor: { key: string; before: Set<string> } | null = null;
  let seq = 0;
  let message = $state('');

  const savedFor = (key: string) => {
    const id = added[key];
    return id ? (app.items.find((i) => i.id === id) ?? null) : null;
  };
  const addedCount = $derived(Object.keys(added).filter((k) => app.items.some((i) => i.id === added[k])).length);

  function openChip(key: string, from: HTMLElement) {
    opener = from;
    const existing = savedFor(key);
    openedFor = { key, before: new Set(app.items.map((i) => i.id)) };
    const form = existing ? formFromItem(existing, app.today) : formFromItem(presetItem(key, app.today), app.today);
    editor = { form, isNew: !existing, key: ++seq };
  }

  async function closeEditor(msg?: string) {
    editor = null;
    if (openedFor) {
      const { key, before } = openedFor;
      const fresh = app.items.find((i) => !before.has(i.id));
      if (fresh) added = { ...added, [key]: fresh.id };
      openedFor = null;
    }
    if (msg) message = msg;
    await tick();
    opener?.focus();
  }

  // ---- finish ----
  let due = $state.raw<EngineEvent[]>([]);
  let paid = $state<string[]>([]);

  /** The sweldo items (built now, so ids are unique against quick-add items too) and any demoted income. */
  function finalWrites(): StoredItem[] {
    if (!withSweldo) return [];
    const fresh = buildSweldoItems(sweldo, asOf, app.items.map((i) => i.id));
    return fresh.ok ? firstRunWrites(app.items, fresh.items) : [];
  }

  function settingsPatch() {
    return { balance: balance.ok ? balance.value : '0', balanceAsOf: asOf, paidOnAsOf: [] as string[] };
  }

  async function toTimeline() {
    if (busy) return;
    busy = 'finish';
    failure = '';
    try {
      const writes = finalWrites();
      const ids = new Set(writes.map((w) => w.id));
      const items = [...app.items.filter((i) => !ids.has(i.id)), ...writes];
      const events = await app.dueOnAsOfFor({ ...app.settings, ...settingsPatch() }, items);
      const rows = checklistRows(events);
      // Keep only ticks for items still on the list (the user may have gone back and changed things).
      paid = paid.filter((id) => rows.some((r) => r.itemId === id));
      if (rows.length > 0) {
        due = events;
        busy = null;
        await go('check');
        return;
      }
      await finish();
    } catch {
      failure = 'Couldn’t save on this device. Check that site data is allowed, then try again.';
    } finally {
      busy = null;
    }
  }

  async function finish() {
    busy = 'finish';
    failure = '';
    try {
      const writes = finalWrites();
      app.navigate('timeline');
      await app.finishFirstRun({ ...settingsPatch(), paidOnAsOf: $state.snapshot(paid) }, writes);
    } catch {
      failure = 'Couldn’t save on this device. Check that site data is allowed, then try again.';
      busy = null;
    }
  }

  // ---- labels ----
  const asOfLabel = $derived(asOf === app.today ? `today, ${formatShort(asOf, thisYear)}` : formatDate(asOf));
</script>

{#snippet icon(d: string)}
  <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path {d} /></svg>
{/snippet}

{#snippet err(id: string, text: string | undefined)}
  {#if text}
    <p class="err" id="{id}-err">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l6.5 12h-13z M8 6.5v3 M8 11.6v.1" /></svg>
      {text}
    </p>
  {/if}
{/snippet}

{#snippet topbar(back: Step)}
  <div class="topbar">
    <button type="button" class="back" onclick={() => go(back)}>
      {@render icon('M15 5l-7 7l7 7')}
      Back
    </button>
    {#if NUMBERED[step]}
      <p class="count">Step {NUMBERED[step]} of 3</p>
    {/if}
  </div>
  {#if NUMBERED[step]}
    <div class="bar" aria-hidden="true">
      {#each [1, 2, 3] as n (n)}
        <span class:on={n <= (NUMBERED[step] ?? 0)}></span>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet failed()}
  {#if failure}<p class="fail" role="alert">{failure}</p>{/if}
{/snippet}

<div class="fr">
  <div class="card">
    {#key step}
      <div class="step">
        {#if step === 'intro'}
          <div class="intro">
            <div class="brand">
              <Logo size={64} />
              <span class="word" aria-hidden="true">lantaw</span>
            </div>
            <h1 id="fr-title" tabindex="-1">See your money months ahead.</h1>
            <p class="lede">
              Add your sweldo, bills and hulog. Drag through time and find your gipit days before they find you.
            </p>
            <ul class="promises">
              <li>
                <span class="badge">{@render icon('M6 11h12v9.5h-12z M8.5 11V8a3.5 3.5 0 0 1 7 0v3')}</span>
                Nothing leaves your device
              </li>
              <li>
                <span class="badge"
                  >{@render icon(
                    'M10 7.5l1.2-1.2a4 4 0 0 1 5.7 5.7l-1.2 1.2 M14 16.5l-1.2 1.2a4 4 0 0 1-5.7-5.7l1.2-1.2 M4 4l16 16',
                  )}</span
                >
                No sign-up, no bank linking
              </li>
              <li>
                <span class="badge"
                  >{@render icon('M2.5 9a14 14 0 0 1 19 0 M5.5 12.5a9.5 9.5 0 0 1 13 0 M9 16a4.5 4.5 0 0 1 6 0 M12 19.5v.1 M3.5 3.5l17 17')}</span
                >
                Works offline
              </li>
            </ul>
          </div>
          <div class="actions">
            {@render failed()}
            <button type="button" class="btn primary" onclick={start} disabled={busy !== null}>Start</button>
            <button type="button" class="btn ghost" onclick={trySample} disabled={busy !== null} aria-busy={busy === 'sample' || undefined}>
              {busy === 'sample' ? 'Loading the sample…' : 'Try a sample budget'}
            </button>
            <button type="button" class="btn text" onclick={() => go('restore')} disabled={busy !== null}>
              Restore from a backup
            </button>
            <p class="fine">Lantaw is Bisaya for “to look out into the distance.”</p>
          </div>
        {:else if step === 'restore'}
          {@render topbar('intro')}
          <div class="body">
            <h1 id="fr-title" tabindex="-1">Restore from a backup</h1>
            <p class="lede">Moving from another phone or browser? Open the backup you exported there.</p>
            <!-- On success the app is onboarded, so first run closes and the Timeline shows. -->
            <RestoreBackup idPrefix="fr-imp" replaceOnly onclose={() => go('intro')} ondone={() => {}} />
          </div>
        {:else if step === 'balance'}
          {@render topbar('intro')}
          <form class="form" novalidate onsubmit={submitBalance}>
            <div class="body">
              <h1 id="fr-title" tabindex="-1">How much money do you have right now?</h1>
              <p class="lede">All your money combined: GCash, Maya, bank and cash.</p>

              <div class="field">
                <label for="fr-balance">Balance</label>
                <div class="money" class:bad={!!balanceError}>
                  <span aria-hidden="true">₱</span>
                  <input
                    id="fr-balance"
                    aria-label="Balance"
                    inputmode="decimal"
                    autocomplete="off"
                    placeholder="0"
                    bind:value={balanceRaw}
                    aria-invalid={balanceError ? 'true' : undefined}
                    aria-describedby={balanceError ? 'fr-balance-err' : undefined}
                  />
                </div>
                {@render err('fr-balance', balanceError)}
              </div>

              <div class="field">
                <label for="fr-asof">As of</label>
                <input
                  id="fr-asof"
                  class="date"
                  type="date"
                  max={app.today}
                  bind:value={asOf}
                  aria-invalid={asOfError ? 'true' : undefined}
                  aria-describedby="fr-asof-hint{asOfError ? ' fr-asof-err' : ''}"
                />
                <p class="hint" id="fr-asof-hint">Usually today. Anything dated after it counts as still coming.</p>
                {@render err('fr-asof', asOfError)}
              </div>
            </div>
            <div class="actions">
              <button type="submit" class="btn primary">Next</button>
            </div>
          </form>
        {:else if step === 'sweldo'}
          {@render topbar('balance')}
          <form class="form" novalidate onsubmit={submitSweldo}>
            <div class="body">
              <h1 id="fr-title" tabindex="-1">How much is your sweldo?</h1>
              <p class="lede">Your take-home pay each payday, after tax and deductions.</p>

              <div class="field">
                <label for="fr-amount">Each payday</label>
                <div class="money" class:bad={!!sweldoErrors.amount}>
                  <span aria-hidden="true">₱</span>
                  <input
                    id="fr-amount"
                    aria-label="Each payday"
                    inputmode="decimal"
                    autocomplete="off"
                    placeholder="0"
                    bind:value={sweldo.amount}
                    aria-invalid={sweldoErrors.amount ? 'true' : undefined}
                    aria-describedby="fr-amount-hint{sweldoErrors.amount ? ' fr-amount-err' : ''}"
                  />
                </div>
                <p class="hint" id="fr-amount-hint" aria-live="polite">{monthlyHint}</p>
                {@render err('fr-amount', sweldoErrors.amount)}
              </div>

              <fieldset class="field">
                <legend>When do you get paid?</legend>
                <div class="opts">
                  {#each SWELDO_SCHEDULES as o (o.id)}
                    <label class="opt">
                      <input
                        type="radio"
                        name="fr-schedule"
                        value={o.id}
                        aria-label={o.label}
                        bind:group={sweldo.schedule}
                      />
                      <span>{o.label}</span>
                    </label>
                  {/each}
                </div>
                <p class="hint">If a payday lands on a weekend or holiday, Lantaw moves it to the working day before.</p>
              </fieldset>

              {#if sweldo.schedule === 'monthly'}
                <div class="field">
                  <label for="fr-payDay">Payday</label>
                  <select
                    id="fr-payDay"
                    class="select"
                    bind:value={sweldo.payDay}
                    aria-describedby={sweldoErrors.payDay ? 'fr-payDay-err' : undefined}
                  >
                    {#each DAYS as d (d)}
                      <option value={d}>{d === 31 ? 'Last day of the month' : `The ${ordinal(d)}`}</option>
                    {/each}
                  </select>
                  {@render err('fr-payDay', sweldoErrors.payDay)}
                </div>
              {:else if isWeekly}
                <div class="field">
                  <label for="fr-nextPayday">Next payday</label>
                  <input
                    id="fr-nextPayday"
                    class="date"
                    type="date"
                    bind:value={sweldo.nextPayday}
                    oninput={() => (nextPaydayTouched = true)}
                    aria-invalid={sweldoErrors.nextPayday ? 'true' : undefined}
                    aria-describedby="fr-nextPayday-hint{sweldoErrors.nextPayday ? ' fr-nextPayday-err' : ''}"
                  />
                  <p class="hint" id="fr-nextPayday-hint">
                    {isIsoDate(sweldo.nextPayday)
                      ? `Then every ${sweldo.schedule === 'weekly' ? '' : 'other '}${weekday(sweldo.nextPayday)}.`
                      : ''}
                  </p>
                  {@render err('fr-nextPayday', sweldoErrors.nextPayday)}
                </div>
              {/if}

              <div class="extra">
                <div class="extra-row">
                  <div>
                    <label class="extra-title" for="fr-13">13th month pay</label>
                    <p class="hint" id="fr-13-hint">Every December 15. Usually one month’s pay.</p>
                  </div>
                  <Toggle
                    id="fr-13"
                    checked={sweldo.thirteenth}
                    label="13th month pay"
                    describedby="fr-13-hint"
                    onchange={(v) => (sweldo.thirteenth = v)}
                  />
                </div>
                {#if sweldo.thirteenth}
                  <div class="field tight">
                    <label for="fr-thirteenthAmount">13th month amount</label>
                    <div class="money small" class:bad={!!sweldoErrors.thirteenthAmount}>
                      <span aria-hidden="true">₱</span>
                      <input
                        id="fr-thirteenthAmount"
                        inputmode="decimal"
                        autocomplete="off"
                        placeholder="0"
                        bind:value={sweldo.thirteenthAmount}
                        aria-label="13th month amount"
                        oninput={(e) => {
                          if (e.currentTarget.value.trim() !== '') thirteenthTouched = true;
                        }}
                        onblur={blurThirteenth}
                        aria-invalid={sweldoErrors.thirteenthAmount ? 'true' : undefined}
                        aria-describedby={sweldoErrors.thirteenthAmount ? 'fr-thirteenthAmount-err' : undefined}
                      />
                    </div>
                    {@render err('fr-thirteenthAmount', sweldoErrors.thirteenthAmount)}
                  </div>
                {/if}
              </div>
            </div>
            <div class="actions">
              <button type="submit" class="btn primary">Next</button>
              <button type="button" class="btn text" onclick={skipSweldo}>I don’t have a regular sweldo</button>
            </div>
          </form>
        {:else if step === 'quick'}
          {@render topbar('sweldo')}
          <div class="body">
            <h1 id="fr-title" tabindex="-1">What do you pay regularly?</h1>
            <p class="lede">Tap to add. Each one opens filled in, so you only fix the amount and date.</p>

            {#each QUICK_GROUPS as g (g.title)}
              <section class="group" aria-labelledby="fr-g-{g.title.replace(/\W+/g, '-')}">
                <h2 class="kicker" id="fr-g-{g.title.replace(/\W+/g, '-')}">{g.title}</h2>
                <ul class="chips">
                  {#each g.keys as key (key)}
                    {@const saved = savedFor(key)}
                    <li>
                      <button
                        type="button"
                        class="chip"
                        class:on={!!saved}
                        aria-label={saved ? `${key}, added. Edit` : `Add ${key}`}
                        onclick={(e) => openChip(key, e.currentTarget)}
                      >
                        {#if saved}
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                        {:else}
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14 M5 12h14" /></svg>
                        {/if}
                        {key}{#if PRESETS[key].currency === 'USD'}<span class="cur">$</span>{/if}
                      </button>
                    </li>
                  {/each}
                </ul>
              </section>
            {/each}
            <p class="hint">
              {addedCount === 0
                ? 'You can skip this and add anything later in Items.'
                : `${addedCount} added. You can add more or change them later in Items.`}
            </p>
          </div>
          <div class="actions">
            {@render failed()}
            <button type="button" class="btn primary" onclick={toTimeline} disabled={busy !== null} aria-busy={busy === 'finish' || undefined}>
              {busy === 'finish' ? 'Getting your timeline…' : 'See my timeline'}
            </button>
          </div>
        {:else if step === 'check'}
          {@render topbar('quick')}
          <div class="body">
            <h1 id="fr-title" tabindex="-1">Already in your balance?</h1>
            <p class="lede">
              These are dated {asOfLabel}, the day of your balance. Tick any that already came in or went out, so
              Lantaw doesn’t count them twice.
            </p>
            <AlreadyInBalance events={due} {paid} onchange={(next) => (paid = next)} />
            <p class="hint">Leave the rest unticked. Lantaw counts them as still coming.</p>
          </div>
          <div class="actions">
            {@render failed()}
            <button type="button" class="btn primary" onclick={finish} disabled={busy !== null} aria-busy={busy === 'finish' || undefined}>
              {busy === 'finish' ? 'Getting your timeline…' : 'See my timeline'}
            </button>
          </div>
        {/if}
      </div>
    {/key}
  </div>
</div>

<p class="sr-only" role="status" aria-live="polite">{message}</p>

{#if editor}
  {#key editor.key}
    <ItemEditor initial={editor.form} isNew={editor.isNew} onclose={closeEditor} />
  {/key}
{/if}

<style>
  .fr {
    display: flex;
    justify-content: center;
    min-height: 100dvh;
    padding: 16px 16px calc(20px + env(safe-area-inset-bottom));
  }
  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    max-width: 30rem;
  }
  .step {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .form {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    gap: 18px;
    min-width: 0;
  }
  @media (prefers-reduced-motion: no-preference) {
    .step {
      animation: step-in 260ms cubic-bezier(0.2, 0.7, 0.3, 1);
    }
  }
  @keyframes step-in {
    from {
      transform: translateY(10px);
      opacity: 0;
    }
  }
  @media (min-width: 1024px) {
    .fr {
      align-items: center;
      padding: 48px 32px;
    }
    .card {
      max-width: 34rem;
      min-height: min(44rem, calc(100dvh - 96px));
      padding: 36px 40px 32px;
      border-radius: 24px;
      background: var(--surface);
      border: 1px solid var(--border);
      box-shadow: 0 24px 60px rgb(3 12 18 / 0.25);
    }
  }

  h1 {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 800;
    line-height: 1.15;
    letter-spacing: -0.03em;
    text-wrap: balance;
  }
  h1:focus {
    outline: none;
  }
  .lede {
    margin: -8px 0 0;
    color: var(--muted);
    text-wrap: pretty;
  }
  .hint {
    margin: 0;
    font-size: 0.875rem;
    color: var(--muted);
    text-wrap: pretty;
  }
  .hint:empty {
    display: none;
  }
  .kicker {
    margin: 0 0 10px;
    font-size: 0.875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--muted);
  }
  .ico {
    width: 20px;
    height: 20px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* ---------- intro ---------- */
  .intro {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    padding-top: 20px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 12px;
  }
  .word {
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: -0.04em;
  }
  .intro h1 {
    font-size: clamp(2rem, 9vw, 2.5rem);
    line-height: 1.08;
    letter-spacing: -0.035em;
  }
  .intro .lede {
    margin: 0;
    font-size: 1.0625rem;
  }
  .promises {
    display: grid;
    gap: 12px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    font-size: 0.9375rem;
    font-weight: 700;
  }
  .promises li {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .badge {
    display: grid;
    place-items: center;
    flex: none;
    width: 38px;
    height: 38px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--teal) 15%, transparent);
    color: var(--teal-text);
  }
  .fine {
    margin: 4px 0 0;
    font-size: 0.875rem;
    color: var(--muted);
    text-align: center;
  }

  /* ---------- top bar + progress ---------- */
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: -6px 0 6px -10px;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    padding: 8px 12px 8px 8px;
    border: 0;
    border-radius: 10px;
    background: none;
    color: var(--text);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .back:hover {
    background: var(--surface-2);
  }
  .count {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .bar {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin-bottom: 22px;
  }
  .bar span {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-2);
    transition: background-color 200ms ease-out;
  }
  .bar span.on {
    background: var(--teal);
  }

  /* ---------- fields ---------- */
  .field {
    display: grid;
    gap: 8px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .field.tight {
    margin-top: 12px;
  }
  label,
  legend {
    padding: 0;
    font-size: 0.9375rem;
    font-weight: 700;
  }
  legend {
    margin-bottom: 8px;
  }
  .money {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    gap: 6px;
    min-height: 64px;
    padding: 0 16px;
    border-radius: 16px;
    border: 1.5px solid var(--border);
    background: var(--surface);
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    transition: border-color 160ms ease-out;
  }
  .money span {
    color: var(--muted);
  }
  .money input {
    flex: 1 1 0;
    /* A percentage width makes the field shrink to fit (form controls
       otherwise keep their intrinsic size and overflow on phones). */
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
  .money.small {
    min-height: 52px;
    font-size: 1.375rem;
  }
  .date,
  .select {
    display: block;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    min-height: 48px;
    padding: 10px 14px;
    border-radius: 14px;
    border: 1.5px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 1rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .date:focus-visible,
  .select:focus-visible {
    outline: none;
    border-color: var(--teal);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--teal) 30%, transparent);
  }
  .date[aria-invalid='true'] {
    border-color: var(--coral);
  }
  .err {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--coral-text);
  }
  .err svg {
    flex: none;
    width: 16px;
    height: 16px;
    margin-top: 2px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* schedule choices: pill radios */
  .opts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .opt {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 8px 16px;
    border-radius: 99px;
    border: 1.5px solid var(--border);
    background: var(--surface-2);
    font-size: 0.9375rem;
    font-weight: 700;
    cursor: pointer;
    transition:
      border-color 160ms ease-out,
      background-color 160ms ease-out,
      color 160ms ease-out;
  }
  .opt:hover {
    border-color: var(--teal);
  }
  .opt input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    clip: rect(0 0 0 0);
    overflow: hidden;
  }
  .opt:has(input:checked) {
    border-color: var(--teal);
    background: color-mix(in srgb, var(--teal) 18%, var(--surface));
    color: var(--teal-text);
  }
  .opt:has(input:focus-visible) {
    outline: 2px solid var(--teal);
    outline-offset: 2px;
  }

  .extra {
    padding: 12px 12px 14px 16px;
    border-radius: 16px;
    border: 1px solid var(--border);
    background: var(--surface);
  }
  .extra-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .extra-title {
    display: block;
    margin: 0;
    font-weight: 700;
    cursor: pointer;
  }
  @media (min-width: 1024px) {
    .money,
    .date,
    .select,
    .extra {
      background: var(--bg);
    }
    .opt {
      background: var(--bg);
    }
  }

  /* ---------- quick add ---------- */
  .group {
    min-width: 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 8px 16px 8px 12px;
    border: 1.5px solid var(--border);
    border-radius: 99px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 700;
    cursor: pointer;
    transition:
      transform 120ms ease-out,
      border-color 160ms ease-out,
      background-color 160ms ease-out;
  }
  .chip:hover {
    border-color: var(--teal);
  }
  .chip:active {
    transform: scale(0.97);
  }
  .chip svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: var(--teal-text);
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .chip.on {
    border-color: var(--teal);
    background: color-mix(in srgb, var(--teal) 18%, var(--surface));
  }
  .cur {
    margin-left: 2px;
    color: var(--muted);
  }

  /* ---------- actions ---------- */
  .actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
    margin-top: auto;
    padding-top: 28px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 52px;
    padding: 12px 20px;
    border-radius: 14px;
    border: 1.5px solid transparent;
    font: inherit;
    font-size: 1rem;
    font-weight: 800;
    cursor: pointer;
    transition:
      transform 120ms ease-out,
      background-color 160ms ease-out;
  }
  .btn:active {
    transform: scale(0.98);
  }
  .btn:disabled {
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
    background: var(--surface-2);
  }
  .btn.text {
    min-height: 44px;
    background: none;
    color: var(--teal-text);
    font-size: 0.9375rem;
    font-weight: 700;
  }
  .btn.text:hover {
    background: var(--surface-2);
  }
  .fail {
    margin: 0;
    padding: 10px 14px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--coral) 12%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--coral) 45%, transparent);
    font-size: 0.9375rem;
    font-weight: 600;
  }
</style>
