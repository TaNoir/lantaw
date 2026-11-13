# Lantaw: follow-ups after v1

These came out of the per-task and whole-branch reviews of v1 (2026-11-13). None of them block v1. They're ordered roughly by how much they matter to users.

## Correctness and robustness
- Move the date and money helpers that the JS layer duplicates into engine exports, so the screens can never disagree with the forecast. They are `firstDate`, `lastPaymentDate`, `shiftMonths` and `convertToPhp` in `items.ts`, and `monthlyPayCentavos` in `onboarding.ts`.
- **Islamic holidays:** a custom date should *replace* Nager's projected Eid date, not be added next to it.
- Load the previous year's holidays when the as-of date is in early January. Today, a Dec 30/31 item using the "next working day" rule can miss them.
- Cap |balance| in the engine so that summed centavos stay below 2^53, which is the JS safe-integer limit.
- When today's payment is ticked in "already in balance", the `paid_override` finish line disappears.
- Check the KDF bounds in Rust as well (defence in depth; the web layer already clamps them).
- The "balance couldn't be read" banner after a restore is kept in memory only, so it disappears on reload.
- **Kaya ba?:** add a "busy" state so stale results can't be added during the 150ms debounce. Also stop adding the same option twice, which currently creates `-2` ids.

## Tests
- Engine boundary tests:
  - `today == horizon_end`
  - paluwagan finish line
  - `paid_override` finish line
  - `BusinessDayRule::Next` in `expand`
  - one-off signs
  - the lookahead path
- A serialization round-trip test for the engine's output types, plus a known-answer test for Argon2.
- Component tests for ItemEditor, KayaBa and AddToPlan. These currently rely on Playwright and manual checks.
- CI: run `cargo test`, `vitest` and Playwright on each push.

## Cleanup
- Consolidate the duplicated `MONTHS`, `pad` and `localToday` helpers. The ScreenGate and Timeline loading markup is also duplicated.
- The Kaya ba? plan-total note is computed in two places.
- The "fill missing settings" path in Merge is effectively dead code.

## Product
- Padala/OFW remittance flows.
- A Bisaya interface translation.
- Optional encrypted sync (v2).
