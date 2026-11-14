# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Filipino earners, mostly salaried, paid kinsenas (15th and 30th) or monthly, who juggle bills, installments (Home Credit, SPayLater, GGives, credit card 0% plans) and paluwagan. They check Lantaw on a phone, often a cheap Android on prepaid data, sometimes on a laptop. Their job: know ahead of time whether they will run short, when, and because of what, and whether they can afford a purchase ("Kaya ba?").

## Product Purpose

Lantaw (Bisaya: "to look out into the distance") forecasts a person's balance day by day for the next 12–24 months from their sweldo, bills, hulog and paluwagan. Success: someone opens the site, enters a balance and sweldo, and within two minutes sees their forecast, with no sign-up.

## Positioning

PH budget apps (Tipid, Lista, Monefy) record what you already spent. Lantaw forecasts what's coming, with exact peso arithmetic and Philippine paydays, holidays and installment habits built in. Nothing leaves the device: no account, no bank linking, no tracking.

## Operating Context

- Paydays: kinsenas, monthly, weekly, every two weeks; 13th month in December. Pay dates shift for weekends and PH holidays (Davao local holidays included by default).
- Cutoffs: the period from one payday to the day before the next. People think in cutoffs.
- Item types: income, bill/subscription, installment (hulog), paluwagan, one-off. Items can be "what-ifs" (excluded) and carry a "paid from" label (GCash, BPI, Cash).
- Foreign-currency items (Netflix in USD, etc.) convert at the latest cached Frankfurter rate.

## Capabilities and Constraints

- Screens: Timeline (home, scrubbable balance chart), Cutoffs, Plans (installment and paluwagan finish lines), Kaya ba? (verdict cards + best date to pay), Items, First run, Settings.
- Signals: gipit day (lowest point before the next payday), installment "done" dates, already-in-balance checklist.
- Static web app + installable PWA, works offline. Rust/WASM engine computes every number and date; the Svelte 5 UI only displays and collects.
- 360px phones up to laptop. Scrubbing the timeline must stay smooth on a low-end phone.
- English UI with Filipino terms (sweldo, hulog, gipit, kinsenas, paluwagan, Kaya ba?). Bisaya/Tagalog translations planned for v1.1.

## Brand Commitments

- Name: Lantaw. From Davao City, for anyone in the Philippines.
- Logo: the Apo Line mark (Mt. Apo's ridge drawn as a balance line, a mango dot marking the point you're looking at) on Night ridge #0E2A3A. Files: docs/brand/lantaw-mark.svg, docs/brand/lantaw-mark-small.svg.
- Typeface: Manrope.
- Anti-goal: looking like a generic Western fintech template.

## Evidence on Hand

- Sample "Davao budget" (web/src/lib/sample/sample-budget.json): illustrative, labeled as sample in the app.
- No users, testimonials, press or usage numbers yet. Do not invent any.

## Product Principles

1. Forecast, not ledger: every screen answers a question about the future.
2. Private by construction: nothing leaves the device; never imply otherwise.
3. Exact money: a peso figure on screen is the engine's figure, never rounded for looks.
4. Local by design: Filipino pay rhythms and words are the default, not a localization layer.
5. Fast on a cheap phone.

## Accessibility & Inclusion

Body text at least 14px; WCAG AA contrast in dark and light themes.
