# Lantaw: design

*Date: 2026-11-13 · Status: ready for owner approval (builder check done)*

> **Lantaw** (Bisaya): to look out into the distance.
> A private cashflow time machine for Filipino budgets: add your sweldo, bills and hulog, then drag along a timeline to see your exact balance on any day in the next 12–24 months.

## 1. Intent and the why

- **The owner's why:** this is the owner's first Rust project. They want it to be good, and they want real people to use it. **Claude plans and builds all of it. The owner makes the product decisions and doesn't write code**, so the plan is for a builder to carry out, not a tutorial. The Rust should still be clean and well commented, so the owner can read it to learn.
- **The user's why:** many Filipinos juggle kinsenas paydays, monthly bills, credit card 0% plans, Home Credit, SPayLater and GGives, plus paluwagan. Few of them want to link a bank account to a cloud finance app. Existing PH budget apps (Tipid, Lista, Monefy) record what you *already* spent. **Lantaw forecasts what's coming.** It answers "will I run short, when, and because of what?" and "kaya ba if I buy this?"
- **Where it comes from:** Davao City. The name, the logo (Mt. Apo) and the local holidays reflect that. It is still meant for anyone in the Philippines.

## 2. Goals, non-goals, anti-goals

**Goals (v1)**
1. Someone opens the site, enters their balance and sweldo, and within two minutes sees a 12–24 month balance forecast. No sign-up.
2. Exact peso arithmetic. A forecast never drifts by a centavo.
3. Paydays and due dates land on the right day: month-end clamping, the 15th and 30th, and shifts for weekends and PH holidays.
4. Five views: **Timeline** (home), **Cutoffs**, **Plans**, **Kaya ba?** and **Items**.
5. Works offline and can be installed as a PWA. Usable on a cheap Android phone over prepaid data, and on a laptop browser.
6. Encrypted backup export and import, so people can move data between devices without a server.

**Non-goals (v1)** (possible later)
- Accounts, cloud sync, Supabase. Maybe in v2 as encrypted-only sync.
- Separate wallets with transfers. v1 has one combined balance.
- Tracking past transactions or categorising spending. That's what Tipid and similar apps do.
- Padala / OFW remittance flows (v1.1).
- Bisaya and Tagalog interface translations (v1.1). v1 is English with Filipino terms built in.
- Native mobile apps. This is a web app plus PWA.

**Anti-goals** (failures even if it "works")
- Any user financial data leaving the device. This includes analytics or error-reporting that contains amounts or item names.
- Looking like a generic Western fintech template.
- A slow or janky timeline slider on a low-end phone.
- Wrong money: floating-point drift, a salary placed on a Saturday, a 31st-of-month bill that slowly drifts to the 28th.

## 3. Constraints

- **Hosting:** static files only, on Vercel's free tier. No backend and no database server.
- **External APIs:** free and keyless only, called straight from the browser (both confirmed to allow CORS):
  - **Frankfurter** `https://api.frankfurter.dev/v1/latest?base=USD&symbols=PHP` for exchange rates
  - **Nager.Date** `https://date.nager.at/api/v3/PublicHolidays/{year}/PH` for PH public holidays (18 entries for 2026)
  - Requests send no user data. Responses are cached and the app works offline after the first load.
- **Privacy:** no personal data is collected, which keeps the app out of Data Privacy Act obligations. No third-party trackers.
- **Currency:** PHP is primary. Some items may be priced in a foreign currency (see §6.4).
- **Devices:** phones from 360px wide up to desktop. Body text is at least 14px and contrast meets WCAG AA.

## 4. Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| **1** | **Rust engine (WASM) + Svelte 5 UI in TypeScript** | Smallest download, mature PWA and storage tooling, fastest path to a polished UI. About a third of the code is Rust, and it's the part that does the real work. | **Chosen by the owner** |
| 2 | All-Rust with Leptos | One language. About twice the download, slower builds, and more hand-rolled PWA and IndexedDB code. | Rejected |
| 3 | Rust engine + React | Same split as option 1 but heavier, and more likely to end up looking generic. | Rejected |

**Rule that follows from option 1:** any logic that decides a number, a date or a security property goes in Rust. Svelte only displays, collects input and stores data.

## 5. What the owner decided

| Decision | Choice |
|---|---|
| Name | **Lantaw** |
| Logo | **Apo Line** mark (the ridge of Mt. Apo doubles as a balance chart; the mango dot is the point you're looking at), on **Night ridge** `#0E2A3A`. Files: `docs/brand/lantaw-mark.svg` and `lantaw-mark-small.svg` (for 16–32px). |
| Typeface | **Manrope** (for the name and headings; also used for body text, see §8) |
| Home screen | **Timeline (direction A)**, with **Cutoffs (B)** and **Plans (C)** as their own tabs |
| Accounts | **None in v1.** Data stays on the device. |
| Balance model | **One combined balance.** Items can carry an optional "paid from" label (GCash, BPI, Cash…) as a reminder only. |
| v1 features | Kaya ba?, Gipit day, per-cutoff view, installment finish lines, paluwagan, offline/PWA |
| Platform | Web app first, installable as a PWA |
| APIs | Frankfurter + Nager.Date. More can be added later. |
| Stack | Option 1 above |
| Kaya ba? | **K1 verdict cards**, plus the **best date to pay cash** suggestion |
| Other screens | First run, Items, Settings and the laptop layout (dark and light) as mocked in `screens-round2.html` |

## 6. How it behaves

### 6.1 First run
1. **Intro screen:** the logo, one sentence ("See your money months ahead. Nothing leaves your device."), and two buttons: **Start** and **Try a sample budget**. The sample loads the Davao budget from the mockups and is clearly labelled as sample data, with a "Clear sample" button.
2. **Balance:** "How much money do you have right now?" This is one number plus an as-of date that defaults to today.
   - **Rule:** the balance already includes everything dated **before** the as-of date and nothing dated **after** it.
   - For items dated **on** the as-of date, Lantaw lists them under the heading "Already in your balance?" with a checkbox each. Unchecked (the default) means the item still counts as upcoming. The same checklist appears whenever the user updates their balance. *(builder's call)*
   - For installments, "k of n paid" is worked out from the first payment date with this same rule. The user can also type k directly, which overrides the calculation.
3. **Sweldo:** amount and schedule. Kinsenas (15th + 30th, or 15th + last day), monthly, weekly or every two weeks. Optional 13th month pay (December, default amount = one month's salary).
4. **Quick add:** tappable chips for common items (Davao Light, DCWD, Internet, Postpaid, Netflix, Spotify, ChatGPT, Home Credit, SPayLater, GGives, Credit card 0%, Paluwagan). Each opens a pre-filled form. Can be skipped.
5. Then the user lands on Timeline.

### 6.2 Item types
Every item has: name, amount, currency (default PHP), optional "paid from" label, an **included** toggle (on by default; turning it off makes the item a "what-if"), and a business-day rule.

| Type | Fields | Notes |
|---|---|---|
| **Income** | amount, schedule, **"main sweldo"** flag | Default business-day rule: *previous working day*. **Exactly one income is the main sweldo.** It's the salary entered on first run, and the user can reassign the flag. Its pay dates (after shifting) define the **cutoffs**: cutoff *i* runs from payday *i* to the day before payday *i+1*. Other inflows (side income, 13th month, paluwagan payout, one-offs) count toward the balance and appear inside whichever cutoff they fall in, but don't create cutoffs. If there is no main sweldo, cutoffs fall back to the 15th and the last day of the month. *(builder's call)* |
| **Bill / subscription** | amount, schedule | Default rule: *none* (lands on the date as written) |
| **Installment (hulog)** | amount per payment, number of payments, first payment date *or* "payments already made: k of n", schedule (usually monthly) | Has a finish line |
| **Paluwagan** | contribution, schedule (weekly / kinsenas / monthly), number of members N, my turn k, start date | Every round except round k is an outflow of the contribution. Round k is a **net inflow of contribution × (N − 1)** on that round's date. That's the same result whether you pay in and get the full pot or skip paying and get the rest, so no toggle is needed. Ends after N rounds. *(builder's call)* |
| **One-off** | amount, date, in or out | For planned purchases, gifts, tuition, etc. |

**Schedules:** once, weekly, every 2 weeks, kinsenas (15th + 30th or last day), monthly on day D, yearly on a month and day, optionally with an end date.

**Business-day rule:** none / previous working day / next working day. A working day is Mon–Fri and not a holiday (§6.5).

### 6.3 Date rules (must be exact)
- **Monthly on day D:** each occurrence is computed **from the anchor date** (start date plus n months), never from the previous occurrence. If D is past the end of the month, it clamps to the last day. Example: Jan 31 gives Feb 28 (or 29), Mar 31, Apr 30, and so on.
- **Kinsenas "30th"** in February is the last day of February.
- **Shift chains:** if the 15th is a Saturday and Friday the 14th is a holiday, *previous working day* gives Thursday the 13th.
- A shifted date never crosses into a different cutoff in a way that double-counts an item.

### 6.4 Foreign-currency items
- An item can be in USD, SGD, EUR, JPY, GBP, AUD, CAD, HKD, or any currency Frankfurter supports.
- Conversion uses the **latest cached rate**, applied to all future occurrences. The UI shows "₱1,275 at ₱63.73/$ (Nov 12)".
- Optional setting: **card foreign-transaction fee %** (default 0). It's added on top, because PH cards often charge 2–3.5%.
- If the app is offline on first use and has no rate cached, it asks the user to type the rate in by hand.

### 6.5 Holidays
- **What counts as non-working:** regular holidays and special non-working days. Special *working* days don't count. *(builder's call; bank and payroll practice in the PH follows this.)* Nager.Date doesn't separate the two non-working kinds, so every Nager entry for PH is treated as non-working.
- **Islamic holidays** (Eid'l Fitr, Eid'l Adha) are proclaimed late. Use Nager's projected date until the user overrides it with a custom date.
- Holidays for each year in the horizon come from Nager.Date and are cached by year.
- The app **ships with a built-in list for 2026–2028** so the very first run works offline. It's generated at build time from Nager.Date, which already projects future years. The API result replaces the built-in list when it's available.
- **Davao City local holidays** (Araw ng Davao, Mar 16) are bundled. They're included by a setting that is **on by default**.
- The user can **add their own holiday dates**. Special non-working days are often announced late by proclamation, and the API can lag.

### 6.6 The forecast
- The forecast starts at the balance's as-of date and runs **day by day** across the horizon (12 or 24 months, chosen by the user, default 12).
- Outputs:
  - a daily balance series
  - the events on each day
  - **Gipit day**: the lowest balance date, plus the items that pushed it down in the preceding cutoff
  - the first day below the **safety buffer** (user setting, default ₱3,000) and the first day below zero
  - **cutoff summaries**: for each payday, income, the bills due before the next payday, and what's left
  - **installment finish lines**: the date of each final payment and the monthly amount it frees up
  - month-end balances
- **What-if overlay:** if any item is toggled off, the Timeline shows a second dashed line with the plan *as if* those items were included, so the user can compare.
- **Stale balance:** if the as-of date is more than 7 days old, show a gentle prompt: "Update your balance? Lantaw expected about ₱X today."

### 6.7 Kaya ba?
- Inputs: item name, cash price, purchase date (default today), and one or more payment options:
  - cash
  - installment of *n* months with a monthly amount; at 0% this auto-fills as price ÷ n
- For each option, show: the lowest balance and its date, the number of days below the buffer, whether the balance ever goes below zero, the total paid, and the monthly hit.
- **✦ Best date to pay cash** (owner approved, mockup K1):
  - Lantaw finds the earliest date D (from today to the end of the horizon) where paying cash on D keeps the balance at or above the safety buffer every day from D onwards. The test is: lowest balance from D onwards, minus the price, is at least the buffer.
  - Lantaw explains why that date works, e.g. "right after your paluwagan payout" or "after your 13th month". The reason is the largest inflow between today and D.
  - If no such date exists within the horizon, show "Not within the next 12 months" (or 24 months, whichever horizon is set).
- **Layout: verdict cards (owner chose K1).** One card per option with a verdict tag:
  - **Kaya**: never below the buffer
  - **Gipit**: dips below the buffer but stays at or above zero, *or* goes below zero for no more than 30 days in total
  - **Hindi kaya**: below zero for more than 30 days
  - The thresholds are the builder's call.
- Cards are sorted best first: the suggested date first, then by lowest balance (highest first), ties broken by lower total paid. Each card shows the lowest balance and its date, the total paid, and any add-on cost compared with the cash price.
- **Add to plan** converts the chosen option into a real item (included) or a what-if item (excluded).

## 7. Screens

**Approved mockups** live in `.superpowers/brainstorm/683-1794516542/content/`:
- `home-layouts.html` covers Timeline, Cutoffs and Plans.
- `screens-round2.html` covers Kaya ba? (K1 verdict cards), first run, Items, Settings and the laptop layout in dark and light.

They are low-fidelity references. The real build refines spacing and type sizes, keeps body text at 14px or more, and never fades text with opacity. Navigation has **five tabs**: Timeline, Cutoffs, Plans, Kaya ba? and Items, with Settings behind a gear icon. The mockup's four-tab bar is out of date.

- **Timeline (home).**
  - Header shows the balance on the selected date and the change from today.
  - Area chart of the balance, with the safety-buffer line, a coral Gipit-day dot, and a mango scrubber.
  - Chips: Gipit day, the next installment finish line, and first-below-buffer if any.
  - Below the chart: the selected cutoff's items.
  - The scrubber works by drag, tap and keyboard (arrows move one day; PageUp/PageDown move one cutoff).
  - Scrubbing **reads from the precomputed series**. It doesn't recompute.
- **Cutoffs.** One card per payday, swipeable or paged. Shows the payday and why it moved ("15th is Sat"), what that sweldo covers, and what's left before the next payday. A sparkline on top shows the overall trend.
- **Plans.** Gantt-style lanes for each installment and paluwagan, ending at the finish line, with a ★ on the paluwagan payout. Below that, the month-end balance as a list of bars.
- **Kaya ba?** As described in §6.7.
- **Items.** A list grouped by type, with search, add/edit/duplicate/delete and the included toggle.
  - What-if items are shown in italics with a dashed icon outline, not faded.
  - ★ marks the main sweldo.
  - Each row shows the amount, the schedule, "k of n · ends Mon YYYY" for hulog, the "paid from" label, and the converted amount for foreign-currency items.
- **Settings** (gear icon):
  - balance and as-of date
  - safety buffer
  - horizon
  - card FX fee
  - Davao local holidays toggle and custom holidays
  - theme (system, dark or light)
  - backup export and import
  - clear all data
  - about and privacy
- **Desktop (1024px and wider):** a left nav rail instead of the bottom tabs. On Timeline the chart takes the full width, and the cutoff detail and upcoming events sit in a right-hand panel.
- **Visual system:**
  - Palette: Gulf ink `#0E2A3A` / `#0B2230`, Lagoon teal `#3FB8AF`, Mango `#F4A940`, Sunset coral `#E8604C`, Sand `#F4F1EA`
  - Dark by default; light theme follows the system setting
  - Manrope throughout; amounts use tabular figures
  - Peso formatting is `₱12,480` (centavos shown only when non-zero)
  - Built-in copy uses Filipino terms with English hints: sweldo, kinsenas, hulog, gipit, Kaya ba?

## 8. Architecture

```
lantaw/
├── engine/                 Rust crate (cdylib + rlib), compiled to WASM with wasm-pack --target web
│   └── src/  lib.rs (wasm-bindgen API) · model.rs · schedule.rs · calendar.rs · project.rs · compare.rs · backup.rs
├── web/                    Vite + Svelte 5 + TypeScript SPA
│   └── src/  lib/engine.ts (WASM wrapper) · lib/db.ts (Dexie) · lib/apis.ts · lib/backup.ts · routes/… · components/…
├── docs/                   specs, plans, brand
└── vercel.json
```

- **Money in Rust:** `rust_decimal::Decimal`. Amounts cross the JS boundary **as decimal strings** (`"2083.33"`), never as floats. Output balances are **integer centavos (i64)**, which are safe as JS numbers for charting. Foreign-exchange conversions round to the centavo, half away from zero.
- **Dates in Rust:** `chrono::NaiveDate`. "Today" is the device's local date, passed in from JS.
- **Engine API (wasm-bindgen, JSON in/out via serde):**
  - `project(input) -> Projection`
  - `compare_purchase(input, options) -> Comparison` (this includes the best cash date)
  - `encrypt_backup(plaintext, passphrase, salt, nonce) -> bytes`
  - `decrypt_backup(…)`
- **Performance target:** a full 24-month recompute in under 10ms on a mid-range phone. Recompute runs when items or settings change, not while scrubbing.
- **Storage:** IndexedDB via Dexie.
  - Tables: `items`, `settings`, `cache` (holidays by year, FX rates with date).
  - Has a schema version so migrations are possible.
  - Calls `navigator.storage.persist()` after the user adds their first item.
- **Backup:**
  - The file is `lantaw-backup-YYYY-MM-DD.lantaw` containing JSON: `{format:"lantaw-backup", version, createdAt, kdf:{alg:"argon2id", m, t, p, salt}, nonce, ciphertext}`.
  - Encryption is **Argon2id + AES-256-GCM in Rust**. JS supplies random salt and nonce from `crypto.getRandomValues`.
  - Import asks for the passphrase, then offers to **replace** or **merge** (merge matches by item id, newest `updatedAt` wins).
  - The UI warns clearly: "If you forget this password, the backup can't be opened."
- **PWA:** `vite-plugin-pwa`.
  - Precaches the app shell and the `.wasm` file.
  - Web manifest uses the Lantaw mark, theme colour `#0E2A3A`, and display `standalone`.
  - Prompts "New version available, reload" when an update is ready.
- **Build and deploy:**
  - The WASM is **built from source in CI**, never committed.
  - The Vercel build command installs the Rust toolchain and wasm-pack, builds `engine`, then builds `web`.
  - `vercel.json` gives `.wasm` files the `application/wasm` content type and adds an SPA fallback.

## 9. Quality bar

- **Rust tests** (the main safety net) cover every date rule in §6.3:
  - Jan 31 monthly, leap years, Feb kinsenas
  - holiday shift chains, paydays across year boundaries
  - installments with k of n already paid
  - paluwagan payout round, FX rounding
  - the sample budget's known Gipit day
  - backup round-trip and wrong-passphrase failure
- **Web tests:** Vitest for the storage and backup flows. A Playwright smoke test of first run, then sample budget, then scrubbing, then Kaya ba?, then backup export and import.
- **Manual check:** a low-end Android phone profile (Chrome DevTools, 4× CPU throttle) shows smooth scrubbing.
- **Accessibility:** the slider has an accessible name and announces the value. Everything works by keyboard. Reduced-motion is respected.

## 10. Owner to-dos outside the code

- A GitHub account and repo, and a Vercel account linked to it. Claude prepares everything; the owner signs in and connects.
- A domain is optional. `lantaw.vercel.app` works until then.

## 11. Left to the builder

- Component breakdown, state management inside Svelte, and styling approach (plain CSS with design tokens is the suggested default).
- Exact Argon2 parameters (aim for about 0.5s on a mid-range phone).
- Wording of in-app copy, within the tone above.
- Exact list of currencies offered in the picker.
- Chart drawing details (hand-written SVG is the suggested default, with no chart library).
