# Lantaw: UI brief

*For finding UI references, briefing a designer, or prompting a design tool.*

## One line

Lantaw is a private cashflow forecaster for Filipinos. You enter your sweldo, bills, hulog and paluwagan, then drag along a timeline to see your exact balance on any day in the next 12–24 months.

## Short description (paste-ready)

> Lantaw ("to look out into the distance" in Bisaya) is a mobile-first web app that shows Filipinos where their money is heading, not where it went. The user enters their current balance, their kinsenas payday (15th and 30th), monthly bills like Davao Light and Globe, installments like Home Credit and SPayLater, and paluwagan rounds. Lantaw then draws their balance forward 12–24 months. The home screen is one big line chart you scrub with a finger: the balance number at the top updates as you drag, and a list beside it shows what lands on each day. It flags the "gipit day" (the lowest point before the next payday), shows when each installment finishes, and answers "Kaya ba?" (can I afford this?) with a verdict card and the best date to pay. Nothing leaves the device: no sign-up, no bank linking, works offline. The brand comes from Davao: the logo is the ridge of Mt. Apo drawn as a balance line, on a deep night-blue (#0E2A3A) with teal, mango (#F4A940) and coral accents, set in Manrope.

## What the UI has to do

| Screen | Job | Key element |
|---|---|---|
| **Timeline** (home) | "How much will I have on day X?" | Scrubbable balance chart, big live balance number, day-by-day list |
| **Cutoffs** | "How does each payday period look?" | One card per pay period: money in, money out, what's left |
| **Plans** | "When do my hulog end?" | Finish lines / progress for installments and paluwagan |
| **Kaya ba?** | "Can I afford this purchase?" | Verdict card (yes / tight / no) + best date to buy |
| **Items** | Manage income, bills, installments | Editable list with type, amount, schedule |
| **First run** | Balance → sweldo → quick-add chips | Under 2 minutes, no account |

Constraints: 360px phones over prepaid data up to laptop; dark is the default theme, light is supported; body text ≥14px, WCAG AA contrast; must stay smooth when scrubbing on a cheap Android.

## The feeling we want

- **Looking ahead, calm:** a forecast, like a weather app, not a ledger or spreadsheet.
- **Local, not a Western fintech template:** Davao and Filipino touches (Mt. Apo, mango, peso-first, Filipino terms) should feel designed in, not sprinkled on.
- **Trustworthy and private:** quiet, confident, no dark patterns, no upsells.
- **One hero per screen:** the chart and the number carry the home screen; everything else supports them.

## Why it currently reads as generic

From the live build: the standard sidebar + content + right-hand list layout, flat dark cards with thin borders, the default icon set, and a small, thin chart that doesn't dominate the page. The brand (the Apo ridge, the night sky, mango) shows up only in the logo and accent colors, not in the layout, the chart or the motion.
