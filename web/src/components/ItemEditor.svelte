<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import Toggle from './Toggle.svelte';
  import { app } from '../lib/state.svelte';
  import { getCachedRate } from '../lib/apis';
  import type { FxRate } from '../lib/engine-types';
  import type { StoredItem } from '../lib/db';
  import { formatPeso, parseAmount, roundToPeso, toCentavos } from '../lib/money';
  import { formatShort, weekday, yearOf } from '../lib/dates';
  import {
    BUSINESS_DAY_LABELS,
    CURRENCIES,
    FIELD_ORDER,
    MONTH_NAMES,
    NAME_MAX,
    PAID_FROM,
    convertToPhp,
    currencySymbol,
    defaultBusinessDay,
    defaultCadence,
    draftFromForm,
    duplicateItem,
    ensureMainSweldo,
    firstDate,
    formFromItem,
    itemsToSave,
    newId,
    validateItem,
    type CadenceType,
    type ItemField,
    type ItemForm,
    type KindType,
  } from '../lib/items';

  let {
    initial,
    isNew,
    onclose,
  }: {
    initial: ItemForm;
    isNew: boolean;
    /** Called once the dialog has closed; `message` is announced by the Items screen. */
    onclose: (message?: string) => void;
  } = $props();

  // ---- form state ----
  let form = $state<ItemForm>(untrack(() => ({ ...initial })));
  /** The stored id being edited; null until a new item is first saved. */
  let editingId = $state<string | null>(untrack(() => (isNew ? null : initial.id)));
  let baseline = $state(untrack(() => JSON.stringify(initial)));
  let attempted = $state(false);
  let saving = $state(false);
  let confirmDelete = $state(false);
  let confirmDiscard = $state(false);
  /** Where focus was when "Discard changes?" appeared, to go back on "Keep editing". */
  let beforeDiscard: HTMLElement | null = null;
  let status = $state('');
  const touched = { cadence: false, businessDay: false };

  const draft = $derived(draftFromForm(form));
  const result = $derived(validateItem(draft));
  const errors = $derived<Partial<Record<ItemField, string>>>(attempted && !result.ok ? result.errors : {});
  const dirty = $derived(JSON.stringify(form) !== baseline);
  const thisYear = $derived(yearOf(app.today));

  const KINDS: { id: KindType; label: string }[] = [
    { id: 'income', label: 'Income' },
    { id: 'bill', label: 'Bill' },
    { id: 'installment', label: 'Hulog' },
    { id: 'paluwagan', label: 'Paluwagan' },
    { id: 'oneOff', label: 'One-off' },
  ];
  const CADENCES: { id: CadenceType; label: string }[] = [
    { id: 'once', label: 'Once' },
    { id: 'weekly', label: 'Every week' },
    { id: 'everyTwoWeeks', label: 'Every 2 weeks' },
    { id: 'kinsenas', label: 'Kinsenas (twice a month)' },
    { id: 'monthly', label: 'Every month' },
    { id: 'yearly', label: 'Every year' },
  ];

  function setKind(k: KindType) {
    const old = form.kind;
    if (k === old) return;
    if (!touched.businessDay || form.businessDay === defaultBusinessDay(old)) form.businessDay = defaultBusinessDay(k);
    if (k === 'oneOff') form.cadence = 'once';
    else if (!touched.cadence && (editingId === null || form.cadence === defaultCadence(old))) {
      form.cadence = defaultCadence(k);
    }
    form.kind = k;
  }

  // ---- main sweldo ----
  const isMainItem = (i: StoredItem) => i.kind.type === 'income' && i.kind.mainSweldo;
  const otherMain = $derived(app.items.find((i) => i.id !== editingId && isMainItem(i)) ?? null);
  const isCurrentMain = $derived(!!editingId && app.items.some((i) => i.id === editingId && isMainItem(i)));
  /** With no other main sweldo, saving an income always makes it the main one. */
  const forcedMain = $derived(otherMain === null);
  /** Who takes over if this main sweldo is saved as another type or deleted (null: nobody). */
  const successor = $derived(
    isCurrentMain ? (ensureMainSweldo(app.items.filter((i) => i.id !== editingId)).find(isMainItem) ?? null) : null,
  );
  const typeChangeNote = $derived(
    isCurrentMain && form.kind !== 'income'
      ? successor
        ? `This is your main sweldo. Saved as another type, ${successor.name} becomes your main sweldo.`
        : 'This is your main sweldo. Saved as another type, your cutoffs fall back to the 15th and the last day of the month.'
      : '',
  );
  const mainHint = $derived.by(() => {
    if (isCurrentMain) {
      return 'This is your main sweldo: its paydays set your cutoffs. To change that, open another income and make it the main sweldo.';
    }
    if (forcedMain) return 'This becomes your main sweldo: its paydays set your cutoffs.';
    return form.mainSweldo
      ? `Its paydays will set your cutoffs instead of ${otherMain!.name}’s.`
      : `Your cutoffs follow ${otherMain!.name}. Switch on to use this pay instead.`;
  });

  // ---- labels that follow the kind and schedule ----
  const amountLabel = $derived(
    {
      income: 'Amount per payday',
      bill: 'Amount',
      installment: 'Amount per payment',
      paluwagan: 'Contribution per round',
      oneOff: 'Amount',
    }[form.kind],
  );
  const startLabel = $derived(
    form.cadence === 'once'
      ? 'Date'
      : form.kind === 'installment'
        ? 'First payment'
        : form.kind === 'paluwagan'
          ? 'First round'
          : 'Starts',
  );
  const showCadence = $derived(form.kind !== 'oneOff' || form.cadence !== 'once');
  const paidLabel = $derived(form.kind === 'income' || (form.kind === 'oneOff' && form.direction === 'in') ? 'Paid into' : 'Paid from');

  const first = $derived(draft.schedule ? firstDate(draft.schedule) : null);
  const firstHint = $derived.by(() => {
    if (!first || form.cadence === 'once') return '';
    const label = `${weekday(first)}, ${formatShort(first, thisYear)}`;
    return form.cadence === 'weekly' || form.cadence === 'everyTwoWeeks'
      ? `Every ${form.cadence === 'weekly' ? '' : 'other '}${weekday(first)}, from ${formatShort(first, thisYear)}.`
      : `First one: ${label}.`;
  });

  // ---- money previews ----
  const parsed = $derived(parseAmount(form.amount));
  const amountCentavos = $derived(parsed.ok ? toCentavos(parsed.value) : null);

  let rate = $state<FxRate | null>(null);
  let rateFor = $state('');
  $effect(() => {
    const cur = form.currency;
    // Re-read after a recompute too: the background refresh may have cached a rate.
    void app.projection;
    if (cur === 'PHP') return;
    let live = true;
    getCachedRate(cur)
      .then((r) => {
        if (!live) return;
        rate = r;
        rateFor = cur;
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  });

  const fxPreview = $derived.by(() => {
    const cur = form.currency;
    if (cur === 'PHP') return null;
    if (rateFor !== cur || !rate) {
      return `No ${cur} rate saved yet. Lantaw fetches it when you’re online, or asks you to type it in.`;
    }
    const perUnit = convertToPhp('1', rate.phpPerUnit, '0');
    const at = `at ${perUnit === null ? rate.phpPerUnit : formatPeso(perUnit)}/${currencySymbol(cur)} (${formatShort(rate.asOf, thisYear)})`;
    const fee = app.settings.cardFxFeePct;
    const feeNote = fee && Number(fee) > 0 ? `, plus your ${fee}% card fee` : '';
    if (!parsed.ok) return `Converted ${at}${feeNote}.`;
    const c = convertToPhp(parsed.value, rate.phpPerUnit, fee);
    if (c === null) return null;
    return `≈ ${formatPeso(roundToPeso(c))} ${at}${feeNote}.`;
  });

  const kindHint = $derived.by(() => {
    if (form.kind === 'installment') {
      const n = Number(form.totalPayments);
      if (amountCentavos !== null && Number.isInteger(n) && n >= 1 && n <= 120) {
        return `${formatPeso(amountCentavos * n)} in total over ${n} payments.`;
      }
    }
    if (form.kind === 'paluwagan') {
      const m = Number(form.members);
      const t = Number(form.myTurn);
      if (amountCentavos !== null && Number.isInteger(m) && m >= 2 && m <= 50 && Number.isInteger(t) && t >= 1 && t <= m) {
        return `On round ${t} you receive ${formatPeso(amountCentavos * (m - 1))} (the other ${m - 1} members’ share). Every other round you pay ${formatPeso(amountCentavos)}.`;
      }
    }
    return '';
  });

  const paidFromOptions = $derived([
    ...new Set([...PAID_FROM, ...app.items.map((i) => i.paidFrom).filter((p): p is string => !!p)]),
  ]);
  const currencyOptions = $derived(
    (CURRENCIES as readonly string[]).includes(form.currency) ? [...CURRENCIES] : [...CURRENCIES, form.currency],
  );

  // ---- a11y helpers ----
  const fid = (k: ItemField) => `ie-${k}`;
  /** aria-describedby for a field: its hint (when shown) and its error (when any). */
  const desc = (k: ItemField, hasHint = false) =>
    [hasHint ? `${fid(k)}-hint` : '', errors[k] ? `${fid(k)}-err` : ''].filter(Boolean).join(' ') || undefined;

  // ---- dialog ----
  let dlg: HTMLDialogElement | undefined = $state();
  let titleEl: HTMLHeadingElement | undefined = $state();
  let closeMessage: string | undefined;

  onMount(() => {
    dlg?.showModal();
    // Typing straight away for a new item; for an edit, start at the title so
    // the phone keyboard doesn't cover the sheet.
    const blank = form.name.trim() === '' ? fid('name') : form.amount === '' ? fid('amount') : null;
    const target = isNew && blank ? document.getElementById(blank) : titleEl;
    target?.focus();
  });

  function close(message?: string) {
    closeMessage = message;
    dlg?.close();
  }

  async function focusFirstError() {
    await tick();
    const errs = result.ok ? {} : result.errors;
    const key = FIELD_ORDER.find((k) => errs[k]);
    if (key) document.getElementById(fid(key))?.focus();
  }

  /** The validated item with its final id, or null (errors shown, first one focused). */
  function validated(): StoredItem | null {
    attempted = true;
    if (!result.ok) {
      void focusFirstError();
      return null;
    }
    const id = editingId ?? newId(result.item.name, app.items.map((i) => i.id));
    return { ...result.item, id };
  }

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (saving) return;
    const item = validated();
    if (!item) return;
    saving = true;
    try {
      const writes = itemsToSave(app.items, item);
      await app.saveItems(writes);
      const promoted = writes.find((w) => w.id !== item.id && isMainItem(w));
      const done = editingId ? `Saved ${item.name}.` : `Added ${item.name}.`;
      close(promoted ? `${done} ${promoted.name} is now your main sweldo.` : done);
    } catch {
      status = 'Couldn’t save on this device. Check that site data is allowed, then try again.';
    } finally {
      saving = false;
    }
  }

  async function duplicate() {
    if (saving || !editingId) return;
    const item = validated();
    if (!item) return;
    saving = true;
    try {
      // The copy takes what the form shows now; the stored original is not written.
      const copy = duplicateItem(item, [...app.items.map((i) => i.id), item.id]);
      await app.saveItems(itemsToSave(app.items, copy));
      const stored = app.items.find((i) => i.id === copy.id) ?? copy;
      form = formFromItem(stored, app.today);
      baseline = JSON.stringify(form);
      editingId = stored.id;
      attempted = false;
      confirmDiscard = false;
      status = `Saved a copy. The original is unchanged. You’re now editing “${stored.name}”.`;
      await tick();
      document.getElementById(fid('name'))?.focus();
    } catch {
      status = 'Couldn’t save the copy on this device. Try again.';
    } finally {
      saving = false;
    }
  }

  async function remove() {
    if (saving || !editingId) return;
    saving = true;
    const name = form.name.trim() || 'the item';
    try {
      await app.deleteItem(editingId);
      // Deleting the main sweldo hands the flag to the earliest remaining income.
      const fixes = ensureMainSweldo(app.items);
      if (fixes.length > 0) await app.saveItems(fixes);
      const promoted = fixes.find(isMainItem);
      close(promoted ? `Deleted ${name}. ${promoted.name} is now your main sweldo.` : `Deleted ${name}.`);
    } catch {
      status = 'Couldn’t delete on this device. Try again.';
      saving = false;
    }
  }

  async function askDelete() {
    confirmDelete = true;
    await tick();
    document.getElementById('ie-del-no')?.focus();
  }
  async function cancelDelete() {
    confirmDelete = false;
    await tick();
    document.getElementById('ie-del')?.focus();
  }

  /** Cancel, ×, Esc and a backdrop tap: close, but ask first when there are unsaved changes. */
  async function requestClose() {
    if (saving) return;
    if (!dirty) {
      close();
      return;
    }
    if (!confirmDiscard) {
      beforeDiscard = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      confirmDiscard = true;
    }
    await tick();
    document.getElementById('ie-keep')?.focus();
  }
  async function keepEditing() {
    confirmDiscard = false;
    await tick();
    (beforeDiscard?.isConnected ? beforeDiscard : titleEl)?.focus();
  }
  /**
   * Esc, in order: dismiss "Discard changes?" (= Keep editing), dismiss the
   * delete confirm, otherwise ask to close. Never closes mid-save or with
   * unsaved edits.
   */
  function handleEscape() {
    if (confirmDiscard) void keepEditing();
    else if (confirmDelete) void cancelDelete();
    else void requestClose();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.isComposing) return;
    // Cancelling keydown stops the browser's close request entirely. Chrome's
    // close watcher makes a second `cancel` without user activation
    // non-cancelable, so `oncancel` alone can't stop a double Esc.
    e.preventDefault();
    handleEscape();
  }
  function onCancel(e: Event) {
    // Fallback for close requests that skip keydown (e.g. Android back).
    e.preventDefault();
    handleEscape();
  }
  function onBackdrop(e: MouseEvent) {
    if (e.target === dlg) void requestClose();
  }
</script>

{#snippet msgs(k: ItemField, hint?: string)}
  {#if hint}<p class="hint" id="{fid(k)}-hint">{hint}</p>{/if}
  {#if errors[k]}
    <p class="err" id="{fid(k)}-err">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l6.5 12h-13z M8 6.5v3 M8 11.6v.1" /></svg>
      {errors[k]}
    </p>
  {/if}
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dlg}
  class="sheet"
  aria-labelledby="ie-title"
  onclose={() => onclose(closeMessage)}
  oncancel={onCancel}
  onkeydown={onKeydown}
  onclick={onBackdrop}
>
  <form class="inner" novalidate onsubmit={save}>
    <header class="head">
      <span class="grip" aria-hidden="true"></span>
      <h2 id="ie-title" tabindex="-1" bind:this={titleEl}>{editingId ? 'Edit item' : 'New item'}</h2>
      <button type="button" class="x" aria-label="Close" onclick={requestClose}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12 M18 6L6 18" /></svg>
      </button>
    </header>

    <div role="status" class="status-region">
      {#if status}<p class="status">{status}</p>{/if}
    </div>

    <div class="body">

      <fieldset class="kinds">
        <legend>Type</legend>
        <div class="seg">
          {#each KINDS as k, n (k.id)}
            <label class="seg-opt">
              <input
                type="radio"
                name="ie-kind"
                id={n === 0 ? fid('kind') : undefined}
                value={k.id}
                checked={form.kind === k.id}
                onchange={() => setKind(k.id)}
              />
              <span>{k.label}</span>
            </label>
          {/each}
        </div>
        {@render msgs('kind')}
        {#if typeChangeNote}<p class="hint">{typeChangeNote}</p>{/if}
      </fieldset>

      <div class="field">
        <label for={fid('name')}>Name</label>
        <input
          id={fid('name')}
          type="text"
          bind:value={form.name}
          maxlength={NAME_MAX}
          autocomplete="off"
          enterkeyhint="next"
          placeholder={form.kind === 'income'
            ? 'e.g. Sweldo'
            : form.kind === 'installment'
              ? 'e.g. Home Credit phone'
              : form.kind === 'paluwagan'
                ? 'e.g. Office paluwagan'
                : form.kind === 'oneOff'
                  ? 'e.g. Pasko gifts'
                  : 'e.g. Davao Light'}
          aria-invalid={!!errors.name}
          aria-describedby={desc('name')}
        />
        {@render msgs('name')}
      </div>

      <div class="pair amount-pair">
        <div class="field">
          <label for={fid('amount')}>{amountLabel}</label>
          <div class="money-in" class:bad={!!errors.amount}>
            <span class="sym" aria-hidden="true">{currencySymbol(form.currency)}</span>
            <input
              id={fid('amount')}
              type="text"
              inputmode="decimal"
              autocomplete="off"
              enterkeyhint="next"
              placeholder="e.g. 1,500"
              bind:value={form.amount}
              aria-invalid={!!errors.amount}
              aria-describedby={desc('amount', !!fxPreview)}
            />
          </div>
        </div>
        <div class="field">
          <label for={fid('currency')}>Currency</label>
          <select id={fid('currency')} bind:value={form.currency} aria-invalid={!!errors.currency} aria-describedby={desc('currency')}>
            {#each currencyOptions as c (c)}<option value={c}>{c}</option>{/each}
          </select>
        </div>
        <div class="pair-msgs">
          {@render msgs('amount', fxPreview ?? undefined)}
          {@render msgs('currency')}
        </div>
      </div>

      {#if form.kind === 'income'}
        <div class="switch-row">
          <div class="switch-text">
            <span id="ie-main-label" class="switch-label">Main sweldo</span>
            <p class="hint" id="ie-main-hint">{mainHint}</p>
          </div>
          <Toggle
            id="ie-main"
            checked={forcedMain || form.mainSweldo}
            disabled={forcedMain}
            labelledby="ie-main-label"
            describedby="ie-main-hint"
            onchange={(v) => (form.mainSweldo = v)}
          />
        </div>
      {:else if form.kind === 'installment'}
        <div class="pair">
          <div class="field">
            <label for={fid('totalPayments')}>Number of payments</label>
            <input
              id={fid('totalPayments')}
              type="text"
              inputmode="numeric"
              autocomplete="off"
              bind:value={form.totalPayments}
              aria-invalid={!!errors.totalPayments}
              aria-describedby={desc('totalPayments')}
            />
          </div>
          <div class="field">
            <label for={fid('paidOverride')}>Already paid <span class="opt">(optional)</span></label>
            <input
              id={fid('paidOverride')}
              type="text"
              inputmode="numeric"
              autocomplete="off"
              placeholder="Count for me"
              bind:value={form.paidOverride}
              aria-invalid={!!errors.paidOverride}
              aria-describedby={desc('paidOverride', true)}
            />
          </div>
          <div class="pair-msgs">
            {@render msgs('totalPayments')}
            {@render msgs(
              'paidOverride',
              form.paidOverride.trim() === ''
                ? 'Leave empty and Lantaw counts from the first payment date.'
                : 'Lantaw counts the remaining payments from your next due date.',
            )}
          </div>
        </div>
        {#if kindHint}<p class="note">{kindHint}</p>{/if}
      {:else if form.kind === 'paluwagan'}
        <div class="pair">
          <div class="field">
            <label for={fid('members')}>Members</label>
            <input
              id={fid('members')}
              type="text"
              inputmode="numeric"
              autocomplete="off"
              bind:value={form.members}
              aria-invalid={!!errors.members}
              aria-describedby={desc('members')}
            />
          </div>
          <div class="field">
            <label for={fid('myTurn')}>My turn</label>
            <input
              id={fid('myTurn')}
              type="text"
              inputmode="numeric"
              autocomplete="off"
              bind:value={form.myTurn}
              aria-invalid={!!errors.myTurn}
              aria-describedby={desc('myTurn')}
            />
          </div>
          <div class="pair-msgs">
            {@render msgs('members')}
            {@render msgs('myTurn')}
          </div>
        </div>
        {#if kindHint}<p class="note">{kindHint}</p>{/if}
      {:else if form.kind === 'oneOff'}
        <fieldset class="kinds">
          <legend>Money</legend>
          <div class="seg">
            <label class="seg-opt">
              <input type="radio" name="ie-dir" value="out" bind:group={form.direction} />
              <span>Going out</span>
            </label>
            <label class="seg-opt">
              <input type="radio" name="ie-dir" value="in" bind:group={form.direction} />
              <span>Coming in</span>
            </label>
          </div>
        </fieldset>
      {/if}

      <section class="group" aria-labelledby="ie-when">
        <h3 id="ie-when" class="group-h">When</h3>

        {#if showCadence}
          <div class="field">
            <label for={fid('every')}>How often</label>
            <select
              id={fid('every')}
              bind:value={form.cadence}
              onchange={() => (touched.cadence = true)}
              aria-invalid={!!errors.every}
              aria-describedby={desc('every')}
            >
              {#each CADENCES as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
            </select>
            {@render msgs('every')}
          </div>
        {/if}

        {#if form.cadence === 'kinsenas'}
          <fieldset class="kinds">
            <legend>Paydays</legend>
            <div class="seg">
              <label class="seg-opt">
                <input type="radio" name="ie-second" value="thirtieth" bind:group={form.second} />
                <span>15th &amp; 30th</span>
              </label>
              <label class="seg-opt">
                <input type="radio" name="ie-second" value="lastDay" bind:group={form.second} />
                <span>15th &amp; last day</span>
              </label>
            </div>
            {#if form.second === 'thirtieth'}<p class="hint">In February, the 30th becomes the last day.</p>{/if}
          </fieldset>
        {:else if form.cadence === 'monthly'}
          <div class="field narrow">
            <label for={fid('day')}>Day of the month</label>
            <input
              id={fid('day')}
              type="text"
              inputmode="numeric"
              autocomplete="off"
              bind:value={form.day}
              aria-invalid={!!errors.day}
              aria-describedby={desc('day', true)}
            />
            {@render msgs('day', 'In shorter months, 29 to 31 fall on the last day.')}
          </div>
        {:else if form.cadence === 'yearly'}
          <div class="pair">
            <div class="field">
              <label for={fid('month')}>Month</label>
              <select id={fid('month')} bind:value={form.month} aria-invalid={!!errors.month} aria-describedby={desc('month')}>
                {#each MONTH_NAMES as m, n (m)}<option value={String(n + 1)}>{m}</option>{/each}
              </select>
            </div>
            <div class="field">
              <label for={fid('day')}>Day</label>
              <input
                id={fid('day')}
                type="text"
                inputmode="numeric"
                autocomplete="off"
                bind:value={form.day}
                aria-invalid={!!errors.day}
                aria-describedby={desc('day')}
              />
            </div>
            <div class="pair-msgs">
              {@render msgs('month')}
              {@render msgs('day')}
            </div>
          </div>
        {/if}

        <div class="pair">
          <div class="field">
            <label for={fid('start')}>{startLabel}</label>
            <input
              id={fid('start')}
              type="date"
              bind:value={form.start}
              aria-invalid={!!errors.start}
              aria-describedby={desc('start', !!firstHint)}
            />
          </div>
          {#if form.cadence !== 'once'}
            <div class="field">
              <label for={fid('end')}>Ends <span class="opt">(optional)</span></label>
              <input
                id={fid('end')}
                type="date"
                bind:value={form.end}
                min={form.start || undefined}
                aria-invalid={!!errors.end}
                aria-describedby={desc('end')}
              />
            </div>
          {/if}
          <div class="pair-msgs">
            {@render msgs('start', firstHint || undefined)}
            {@render msgs('end')}
          </div>
        </div>

        <div class="field">
          <label for="ie-bday">If it falls on a weekend or holiday</label>
          <select id="ie-bday" bind:value={form.businessDay} onchange={() => (touched.businessDay = true)}>
            {#each Object.entries(BUSINESS_DAY_LABELS) as [v, l] (v)}<option value={v}>{l}</option>{/each}
          </select>
        </div>
      </section>

      <section class="group" aria-labelledby="ie-more">
        <h3 id="ie-more" class="group-h">More</h3>
        <div class="field">
          <label for="ie-paid">{paidLabel} <span class="opt">(optional)</span></label>
          <input
            id="ie-paid"
            type="text"
            list="ie-paid-list"
            autocomplete="off"
            maxlength="30"
            placeholder="e.g. GCash, Maya, BPI"
            bind:value={form.paidFrom}
          />
          <datalist id="ie-paid-list">
            {#each paidFromOptions as o (o)}<option value={o}></option>{/each}
          </datalist>
        </div>

        <div class="switch-row">
          <div class="switch-text">
            <span id="ie-inc-label" class="switch-label">Count in my forecast</span>
            <p class="hint" id="ie-inc-hint">
              {form.included
                ? 'Switch off to make it a what-if: the Timeline shows it as a dashed line without counting it.'
                : 'What-if: shown as a dashed line on the Timeline, not counted in your balance.'}
            </p>
          </div>
          <Toggle
            checked={form.included}
            labelledby="ie-inc-label"
            describedby="ie-inc-hint"
            onchange={(v) => (form.included = v)}
          />
        </div>
      </section>

      {#if editingId}
        <div class="danger">
          {#if confirmDelete}
            <p class="confirm" id="ie-del-q">
              Delete “{form.name.trim() || 'this item'}”? This can’t be undone.{#if successor}
                {' '}{successor.name} becomes your main sweldo.{/if}
            </p>
            <div class="confirm-btns" role="group" aria-labelledby="ie-del-q">
              <button type="button" class="btn ghost" id="ie-del-no" onclick={cancelDelete}>Cancel</button>
              <button type="button" class="btn danger-btn" onclick={remove} disabled={saving}>Yes, delete</button>
            </div>
          {:else}
            <button type="button" class="link" onclick={duplicate} disabled={saving}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h12v12H8z M16 8V4H4v12h4" /></svg>
              Duplicate
            </button>
            <button type="button" class="link del" id="ie-del" onclick={askDelete}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16 M9 7V4h6v3 M6.5 7l1 13h9l1-13" /></svg>
              Delete
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <footer class="foot" class:ask={confirmDiscard}>
      {#if confirmDiscard}
        <p class="confirm" id="ie-discard-q">Discard your changes?</p>
        <div class="confirm-btns" role="group" aria-labelledby="ie-discard-q">
          <button type="button" class="btn ghost" id="ie-keep" onclick={keepEditing}>Keep editing</button>
          <button type="button" class="btn danger-btn" onclick={() => close()}>Discard</button>
        </div>
      {:else}
        <button type="button" class="btn ghost" onclick={requestClose}>Cancel</button>
        <button type="submit" class="btn primary" aria-busy={saving || undefined}>
          {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add item'}
        </button>
      {/if}
    </footer>
  </form>
</dialog>

<style>
  /* ---------- the sheet: bottom sheet on phones, centred dialog from 1024px ---------- */
  .sheet {
    position: fixed;
    inset: auto 0 0 0;
    width: 100%;
    max-width: 100%;
    max-height: min(94dvh, 100%);
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 22px 22px 0 0;
    background: var(--glass-solid);
    color: var(--text);
    box-shadow: 0 -16px 48px rgb(3 12 18 / 0.45);
    overflow: hidden;
  }
  .sheet[open] {
    display: flex;
    animation: sheet-up 260ms cubic-bezier(0.22, 0.9, 0.3, 1);
  }
  .sheet::backdrop {
    background: rgb(4 14 20 / 0.62);
    animation: fade 200ms ease-out;
  }
  @keyframes sheet-up {
    from {
      transform: translateY(40%);
      opacity: 0;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @media (min-width: 1024px) {
    .sheet {
      inset: 0;
      width: min(38rem, calc(100% - 64px));
      max-height: min(88dvh, 56rem);
      margin: auto;
      border: 1px solid var(--border);
      border-radius: 20px;
      box-shadow: 0 24px 64px rgb(3 12 18 / 0.5);
    }
    .sheet[open] {
      animation-name: pop;
      animation-duration: 200ms;
    }
    @keyframes pop {
      from {
        transform: translateY(10px) scale(0.985);
        opacity: 0;
      }
    }
  }
  :global(html:has(dialog.sheet[open])) {
    overflow: hidden;
  }

  .inner {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
  }

  .head {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 18px 12px 10px 20px;
    border-bottom: 1px solid var(--border);
  }
  .grip {
    position: absolute;
    top: 7px;
    left: 50%;
    width: 40px;
    height: 4px;
    margin-left: -20px;
    border-radius: 2px;
    background: var(--border);
  }
  .head h2 {
    flex: 1;
    margin: 0;
    font-size: 1.25rem;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  .head h2:focus {
    outline: none;
  }
  .head h2:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: 4px;
    border-radius: 4px;
  }
  .x {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 12px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .x:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .x svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
  @media (min-width: 1024px) {
    .grip {
      display: none;
    }
    .head {
      padding-top: 14px;
    }
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px 20px 20px;
    display: grid;
    gap: 16px;
    align-content: start;
  }

  .foot {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px;
    padding: 12px 20px calc(12px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
    background: var(--surface);
  }

  .foot.ask {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
  }
  .foot.ask .confirm {
    flex: 1 1 auto;
  }

  /* ---------- fields ---------- */
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  legend,
  label,
  .switch-label {
    display: block;
    margin-bottom: 6px;
    padding: 0;
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--text);
  }
  .opt {
    font-weight: 600;
    color: var(--muted);
  }
  .field {
    display: grid;
    min-width: 0;
    align-content: start;
  }
  .narrow {
    max-width: 12rem;
  }
  input[type='text'],
  input[type='date'],
  select {
    width: 100%;
    min-height: 48px;
    padding: 10px 12px;
    border: 1.5px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 1rem;
    font-variant-numeric: tabular-nums;
    transition: border-color 140ms ease-out;
  }
  input::placeholder {
    color: var(--muted);
  }
  select {
    appearance: none;
    padding-right: 36px;
    background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%),
      linear-gradient(135deg, var(--muted) 50%, transparent 50%);
    background-position:
      calc(100% - 19px) 52%,
      calc(100% - 14px) 52%;
    background-size: 5px 5px;
    background-repeat: no-repeat;
  }
  input:hover,
  select:hover {
    border-color: color-mix(in srgb, var(--muted) 60%, var(--border));
  }
  input:focus-visible,
  select:focus-visible {
    outline: none;
    border-color: var(--teal);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--teal) 30%, transparent);
  }
  [aria-invalid='true'] {
    border-color: var(--coral);
  }

  /* The currency symbol sits inside the field's border, before the number. */
  .money-in {
    display: flex;
    align-items: center;
    min-height: 48px;
    border: 1.5px solid var(--border);
    border-radius: 12px;
    background: var(--bg);
    transition: border-color 140ms ease-out;
  }
  .money-in:hover {
    border-color: color-mix(in srgb, var(--muted) 60%, var(--border));
  }
  .money-in:focus-within {
    border-color: var(--teal);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--teal) 30%, transparent);
  }
  .money-in.bad {
    border-color: var(--coral);
  }
  .money-in .sym {
    flex: none;
    padding-left: 13px;
    color: var(--muted);
    font-size: 1.125rem;
    font-weight: 700;
  }
  .money-in input[type='text'] {
    min-width: 0;
    padding-left: 6px;
    border: 0;
    background: transparent;
    font-size: 1.25rem;
    font-weight: 800;
  }
  .money-in input[type='text']:focus-visible {
    box-shadow: none;
  }

  .pair {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 12px;
  }
  .amount-pair {
    grid-template-columns: minmax(0, 1fr) 7rem;
  }
  .pair-msgs {
    grid-column: 1 / -1;
  }
  .pair-msgs:empty {
    display: none;
  }

  .hint,
  .err,
  .note {
    margin: 6px 0 0;
    font-size: 0.875rem;
    line-height: 1.45;
  }
  .hint {
    color: var(--muted);
  }
  .note {
    margin-top: -6px;
    color: var(--muted);
  }
  .err {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    color: var(--coral-text);
    font-weight: 600;
  }
  .err svg {
    flex: none;
    width: 16px;
    height: 16px;
    margin-top: 2px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  /* Segmented radio chips (type, money direction, kinsenas). */
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
    min-height: 40px;
    padding: 8px 14px;
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

  .switch-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .switch-text {
    flex: 1;
    min-width: 0;
  }
  .switch-text .switch-label {
    margin: 0;
    padding-top: 10px;
  }
  .switch-text .hint {
    margin-top: 2px;
  }

  .group {
    display: grid;
    gap: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .group-h {
    margin: 0 0 -6px;
    font-size: 0.875rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--muted);
  }

  .status {
    margin: 12px 20px 0;
    padding: 10px 12px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--teal) 14%, transparent);
    font-size: 0.9375rem;
    font-weight: 600;
  }

  /* ---------- buttons ---------- */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 10px 18px;
    border: 1.5px solid transparent;
    border-radius: 14px;
    font: inherit;
    font-size: 1rem;
    font-weight: 800;
    cursor: pointer;
    transition:
      transform 120ms ease-out,
      background-color 160ms ease-out,
      border-color 160ms ease-out;
  }
  .btn:active {
    transform: scale(0.97);
  }
  .primary {
    background: var(--mango);
    color: var(--on-mango);
  }
  .primary:hover {
    background: color-mix(in srgb, var(--mango) 88%, var(--text));
  }
  .ghost {
    background: transparent;
    border-color: var(--border);
    color: var(--text);
  }
  .ghost:hover {
    border-color: var(--muted);
  }
  .danger-btn {
    background: color-mix(in srgb, var(--coral) 16%, transparent);
    border-color: var(--coral);
    color: var(--coral-text);
  }
  .danger-btn:hover {
    background: color-mix(in srgb, var(--coral) 26%, transparent);
  }

  .danger {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 8px 12px;
    margin-left: -12px;
    border: 0;
    border-radius: 12px;
    background: none;
    color: var(--teal-text);
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 700;
    cursor: pointer;
  }
  .link + .link {
    margin-left: 0;
  }
  .link:hover {
    background: var(--surface-2);
  }
  .link.del {
    margin-left: auto;
    color: var(--coral-text);
  }
  .link svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .confirm {
    flex: 1 1 100%;
    margin: 0;
    font-weight: 700;
  }
  .confirm-btns {
    display: flex;
    gap: 10px;
  }
</style>
