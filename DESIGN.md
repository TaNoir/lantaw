---
name: Lantaw
description: Horizon. A cashflow forecast drawn as the nearest ridge in front of Mt. Apo, at night by default and in morning light by day.
colors:
  # Night (default)
  mango: "#f4a940"
  mango-text: "#f6bd6a"
  on-mango: "#10222e"
  teal: "#3fb8af"
  teal-text: "#7fd8cf"
  coral: "#e8604c"
  coral-text: "#f39a8b"
  land-label: "#f39a8b"
  bg: "#071821"
  text: "#f4f1ea"
  muted: "#a9bcc6"
  muted-2: "#8fa6b2"
  surface: "rgba(9, 28, 39, 0.66)"
  surface-2: "rgba(244, 241, 234, 0.07)"
  border: "rgba(244, 241, 234, 0.12)"
  glass: "rgba(8, 26, 36, 0.62)"
  glass-solid: "rgba(10, 30, 41, 0.94)"
  glass-line: "rgba(244, 241, 234, 0.1)"
  glass-hover: "rgba(244, 241, 234, 0.08)"
  pill-on: "#f4f1ea"
  on-pill: "#0e2a3a"
  range-far-top: "#2b5366"
  range-far-bottom: "#1a3d4f"
  range-mid-top: "#1b4052"
  range-mid-bottom: "#11303f"
  haze: "#24485a"
  ridge-top: "#0f2f3f"
  ridge-mid: "#0a2230"
  ridge-bottom: "#061219"
  rim-start: "rgba(244, 241, 234, 0.55)"
  rim-mid: "rgba(244, 241, 234, 0.92)"
  rim-end: "rgba(244, 169, 64, 0.85)"
  # Day (data-theme='light', or the system's light preference when no theme is set)
  mango-day: "#c9790f"
  mango-text-day: "#9a5c06"
  on-mango-day: "#ffffff"
  teal-day: "#1f8a84"
  teal-text-day: "#0d5f5a"
  coral-day: "#c9472f"
  coral-text-day: "#9c2f1b"
  land-label-day: "#7f200c"
  bg-day: "#eef0ec"
  text-day: "#10222e"
  muted-day: "#3f545e"
  muted-2-day: "#4a5f69"
  surface-day: "rgba(255, 255, 255, 0.84)"
  surface-2-day: "rgba(16, 34, 46, 0.055)"
  border-day: "rgba(16, 34, 46, 0.12)"
  glass-day: "rgba(255, 255, 255, 0.66)"
  glass-solid-day: "rgba(255, 255, 255, 0.95)"
  glass-line-day: "rgba(16, 34, 46, 0.09)"
  glass-hover-day: "rgba(16, 34, 46, 0.05)"
  pill-on-day: "#0e2a3a"
  on-pill-day: "#f4f1ea"
  range-far-top-day: "#b9ced8"
  range-far-bottom-day: "#d3e0e4"
  range-mid-top-day: "#bccfd7"
  range-mid-bottom-day: "#d3dfe3"
  haze-day: "#f2ede2"
  ridge-top-day: "#cdbf9e"
  ridge-mid-day: "#c8ba98"
  ridge-bottom-day: "#d2c7ab"
  rim-start-day: "rgba(14, 42, 58, 0.6)"
  rim-mid-day: "rgba(14, 42, 58, 0.95)"
  rim-end-day: "rgba(201, 121, 15, 0.95)"
typography:
  display:
    fontFamily: "'Manrope Variable', system-ui, sans-serif"
    fontSize: "clamp(4.5rem, 6.6vw, 6.5rem)"
    fontWeight: 230
    lineHeight: 1
    letterSpacing: "-0.04em"
    fontFeature: "tnum"
  figure:
    fontFamily: "'Manrope Variable', system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 11vw, 3.75rem)"
    fontWeight: 250
    lineHeight: 1.05
    letterSpacing: "-0.04em"
    fontFeature: "tnum"
  headline:
    fontFamily: "'Manrope Variable', system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 6vw, 2.75rem)"
    fontWeight: 300
    lineHeight: 1.1
    letterSpacing: "-0.04em"
  title:
    fontFamily: "'Manrope Variable', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 750
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Manrope Variable', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "'Manrope Variable', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
    lineHeight: 1.25
rounded:
  pill: "99px"
  tab-bar: "24px"
  card: "22px"
  block: "14px"
  field: "12px"
  small: "10px"
spacing:
  page-phone: "16px"
  page-desktop: "32px"
  card-gap: "14px"
  card-gap-wide: "20px"
  topbar: "72px"
components:
  nav-pill-bar:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "4px"
  nav-pill-item:
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "40px"
  nav-pill-item-active:
    backgroundColor: "{colors.pill-on}"
    textColor: "{colors.on-pill}"
  tab-bar:
    backgroundColor: "{colors.glass-solid}"
    textColor: "{colors.muted}"
    rounded: "{rounded.tab-bar}"
    padding: "4px"
  tab-bar-item-active:
    backgroundColor: "{colors.pill-on}"
    textColor: "{colors.on-pill}"
    rounded: "{rounded.pill}"
    size: "48px 28px"
  time-bar:
    backgroundColor: "{colors.glass-solid}"
    rounded: "{rounded.pill}"
    padding: "8px 12px 8px 8px"
  play-button:
    backgroundColor: "{colors.mango}"
    textColor: "{colors.on-mango}"
    rounded: "{rounded.pill}"
    size: "46px"
  button-primary:
    backgroundColor: "{colors.mango}"
    textColor: "{colors.on-mango}"
    rounded: "{rounded.field}"
    padding: "10px 18px"
    height: "44px"
  button-ghost:
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "10px 18px"
    height: "44px"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
    height: "36px"
  chip-coral:
    textColor: "{colors.coral-text}"
  chip-teal:
    textColor: "{colors.teal-text}"
  chip-mango:
    textColor: "{colors.text}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "14px 16px"
  panel:
    backgroundColor: "{colors.glass-solid}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "18px 16px"
    width: "368px"
  input-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.field}"
    padding: "10px 14px"
    height: "48px"
  input-money:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.block}"
    padding: "0 16px"
    height: "60px"
---

# Design System: Lantaw

## Overview

**Creative North Star: "The View from the Ridge"**

Lantaw is a view, and the screen is the landscape. A fixed sky sits behind every screen; a static silhouette of the Mt. Apo range, twin summit right of centre, stands in the middle distance; and on the Timeline the forecast itself is the nearest ridge, its balance line drawn as the rim of the land. Nothing in the system is a dashboard: there is no sidebar, no card grid around a small chart. Controls float over the scene as pills and panes of glass.

Night is the default. The sky runs from near-black blue down to a teal-blue horizon with a mango dawn glow, and the forecast land is the darkest thing on screen, edged by a sand line that warms to mango toward the far end of the forecast. Day is the same view in morning light: pale blue-to-sand sky, haze, a sand ridge with a night-blue rim. Both themes share one drawing; only the scene tokens change.

Type is one family, Manrope Variable, used at two extremes. Money figures and page headings are thin and large; everything you press or scan is heavy and small. Colour carries meaning before it carries decoration: teal is money coming in, coral is the safety buffer and the gipit day, mango is the day you are looking at.

**Key Characteristics:**
- One landscape behind every screen: fixed sky, far range, and on the Timeline the forecast ridge.
- Night default, day as the same scene relit; never two different layouts.
- Thin figures (230 to 300) against heavy UI text (600 to 800), one typeface.
- Three meaning colours, each with a darker or lighter text-safe partner.
- Floating pill chrome and translucent panes; real blur only on wide screens.
- Chart furniture (months, paydays, buffer, gipit) is drawn on the land itself.

## Colors

A night-blue landscape lit by three signal colours; in day the same three signals deepen so they hold contrast on pale sky and sand.

### Primary
- **Dawn Mango** (`mango`, day `mango-day`): the day you are looking at. The scrubber knob and scan line, the play button, the time bar's filled rail, the highlighted rows for the selected day, the today dot on the Cutoffs sparkline. It is also the fill of the primary button and the global focus outline. `on-mango` is the only text colour placed on it.
- **Mango Text** (`mango-text`, day `mango-text-day`): mango for small text on a surface, used for the date column of selected-day rows.

### Secondary
- **Tide Teal** (`teal`, day `teal-day`): money in and things going well. Field focus borders and rings, selected option pills, the "best" verdict tint.
- **Teal Text** (`teal-text`, day `teal-text-day`): positive amounts (`+₱`), finish-line chips, text buttons.

### Tertiary
- **Gipit Coral** (`coral`, day `coral-day`): the safety buffer and the gipit day. The rim turns coral wherever the balance runs under the buffer; the gipit dot; error borders; the over-budget meter.
- **Coral Text** (`coral-text`, day `coral-text-day`): low balances, the big figure when under buffer, error text, the dotted buffer line.
- **Land Label** (`land-label`, day `land-label-day`): coral for text drawn directly on the land ("Safety buffer", "Gipit day"). It is its own token because the land is not a normal surface: in day the ridge is sand, so the label drops to a deep brick to stay legible.

### Neutral
- **Night Ground** (`bg`, day `bg-day`): the colour under the sky; shows where a card steps down to the page.
- **Sand** (`text`, day `text-day`): body text; night-blue ink in day.
- **Mist** (`muted`) and **Far Mist** (`muted-2`): supporting text, dates, tick marks, disabled icons.
- **Pane** (`surface`), **Tint** (`surface-2`), **Hairline** (`border`): cards, inset blocks inside cards, and 1px card edges and row dividers on the ordinary screens.
- **Glass** (`glass`), **Solid Glass** (`glass-solid`), **Glass Line** (`glass-line`), **Glass Hover** (`glass-hover`): floating chrome over the scene. Glass is used only where blur is on; Solid Glass is its opaque stand-in everywhere else.
- **Pill On** (`pill-on`) with **On Pill** (`on-pill`): the selected nav pill, selected tab icon, and the time bar's date handle. Sand on night-blue at night, inverted in day.
- **The scene**: `range-far-*`, `range-mid-*`, `haze` (far mountains), `ridge-top/mid/bottom` (the forecast land), `rim-start/mid/end` (the balance line's gradient). The sky itself is a token (`--sky`): two radial glows (mango at the horizon, teal lower left; day has the mango glow only) over a five-stop vertical gradient.

### Named Rules
**The Three Signals Rule.** On the forecast and in money data, teal means money in, coral means buffer and gipit, mango means the day you are looking at. In controls the same three keep fixed jobs: mango is the primary action and the focus outline, teal is field focus and the selected option, coral is error and destructive. None of the three is used as plain decoration, and no fourth signal colour exists.

**The Text Partner Rule.** `teal`, `coral` and `mango` are fills, strokes and borders. Text in those hues uses `teal-text`, `coral-text`, `mango-text`. Mango chips go further: they keep body text and carry mango in the glyph and border only, because mango text fails contrast in day.

**The Land Label Rule.** Text drawn on the land uses `land-label` with a 7px halo in `ridge-mid` painted under the letters, never a chip or box.

## Typography

**Display Font:** Manrope Variable (with system-ui, sans-serif)
**Body Font:** Manrope Variable (with system-ui, sans-serif)

**Character:** One variable family stretched to both ends of its weight axis. Thin, tightly tracked numerals read as a horizon line; heavy small text reads as controls. Tabular figures are on for the whole document so amounts line up.

### Hierarchy
- **Display** (230, `clamp(4.5rem, 6.6vw, 6.5rem)` at 1024px and wider, `clamp(3.25rem, 14vw, 4.5rem)` below, line-height 1, -0.04em): the Timeline balance. The peso sign sits at 0.6em in weight 300 and muted; centavos at 0.42em in weight 400, both raised.
- **Figure** (250, `clamp(2.75rem, 11vw, 3.75rem)`, line-height 1.05, -0.04em): the lead amount on a card (Cutoffs).
- **Headline** (300, `clamp(2.25rem, 6vw, 2.75rem)`, line-height 1.1, -0.04em): page headings (Settings, Items, Kaya ba?) and the First run intro heading.
- **Title** (750 to 800, 1rem to 1.125rem, -0.01em): panel and card titles, editor headings. Empty-state headings step up to 1.375rem to 1.5rem at 800, -0.02em.
- **Body** (400, 1rem, line-height 1.5; the Timeline sentence is 1.0625rem at 1.55 on wide screens, capped at 46ch): explanatory text. Names in lists are 600 to 650; amounts are 700 to 800.
- **Label** (700, 0.875rem, line-height 1.25): chips, date columns, hints at 400, tab and nav labels (0.9375rem in the top pill bar).

### Named Rules
**The Thin Figure Rule.** Weights 230 to 300 are for money figures and page headings only, at 2.25rem and larger. Anything smaller or pressable is 600 to 800.

**The Tracking Floor Rule.** Letter-spacing never goes tighter than -0.04em, and -0.04em is reserved for thin display sizes and the wordmark.

**The Upright Rule.** No italics anywhere. What-ifs are marked with muted colour, a dashed line or a struck-through amount.

## Layout

The shell is a 72px top bar on wide screens (brand left, pill nav centred, privacy note and settings right) and a compact top row plus a floating bottom tab bar on phones. The main breakpoint is 1024px; 640px gives the land more height and lets chips wrap; 1100px to 1280px open second columns on Settings, Items and Plans.

The Timeline is the full view. At 1024px and wider it fills the viewport under the top bar (minimum 660px tall): readout top-left with 48px side padding, the land full-bleed across the lower part, a 368px cutoff panel floating top-right, and the time bar pinned 24px from the bottom. The forecast stops before the panel while the land runs on underneath it. On phones the same parts stack: readout, a 240px land (340px from 640px), time bar, then the panel in the flow, with 96px of bottom room for the tab bar.

Every other screen is a centred column of glass cards over the sky, 16px page padding on phones and 32px on wide screens, cards 14px apart (20px in two-column layouts), inside a 1240px maximum. Column widths are set per screen in rem (40rem to 76rem). Behind them the far range sits low and quiet: fixed to the bottom, 44dvh tall, at half opacity.

Spacing in components is written as literal values on a loose 2px grid (most often 8, 10, 12, 14, 16, 24, 32). Touch targets are 44px minimum; chips and small buttons are 36px.

## Elevation & Depth

Depth comes from the scene, not from shadows: sky, far range, haze, mid range, then the forecast land, each a darker or closer tone. Interface surfaces are panes over that scene. Cards on ordinary screens are translucent (`surface`) with a 1px `border` and no shadow. Only chrome that truly floats over the land carries a shadow.

### Shadow Vocabulary
- **Float** (`--shadow-float`: `0 24px 60px -24px rgba(0, 0, 0, 0.6)` at night, `0 22px 50px -26px rgba(16, 34, 46, 0.35)` in day): the phone tab bar, the time bar, the Timeline panel on wide screens.
- **Handle** (`0 6px 16px -8px rgba(0, 0, 0, 0.5)`): the time bar's date handle.
- **Overlay** (`0 8px 24px rgb(3 12 18 / 0.35)` toast; `0 24px 64px rgb(3 12 18 / 0.5)` dialog; `0 -16px 48px rgb(3 12 18 / 0.45)` bottom sheet): things that sit above the page.
- **Field ring** (`0 0 0 3px` of teal at 30%): focus on inputs, with a teal border.

### Named Rules
**The Wide Blur Rule.** `backdrop-filter` is used only at 1024px and wider, and only when the visitor has not asked for reduced transparency. There it pairs with `glass` (nav 14px, time bar 16px, panel 22px with 1.15 saturation). Everywhere else the same element uses `glass-solid` with no blur, so scrubbing stays smooth on a cheap phone.

**The One Scene Rule.** The sky is fixed and identical on every screen. Pages scroll over it; nothing paints an opaque full-page background on top of it.

## Shapes

Round and soft, in three families. Floating chrome and anything you toggle is a full pill (99px): nav, time bar, play button, chips, option pills, the date handle. Containers are large-radius panes: 22px for cards and the panel, 24px for the phone tab bar. Things inside a card step down: 14px for inset editors and money fields, 12px for text fields, buttons and list rows, 10px for small icon buttons and focus shapes.

Lines are thin and quiet: 1px hairlines for card edges and dividers, 1.5px for field borders. Icons are drawn, not filled: 24px grid, round caps and joins, about 1.9 to 2.2px stroke in the current text colour. The rim of the land is a 1.75px line with round joins (2px in coral under the buffer); dotted and dashed lines (buffer `2 6`, today `2 4`, what-if `6 5`) distinguish reference lines from the rim.

## Components

### Buttons
- **Shape:** softly squared (12px), 44px minimum height, 10px 18px padding, weight 800 at 0.9375rem. Small variant 36px.
- **Primary:** mango fill with `on-mango` text. Hover mixes 12% of the text colour into the mango. Press scales to 0.97 over 120ms.
- **Ghost:** transparent with a hairline border and body text; hover fills with the surface or glass-hover tone.
- **Danger:** outlined in coral with coral text, never a coral fill.
- **Text button:** teal text, no border, 44px target; hover shows a surface fill.
- **Focus:** the global 2px mango outline at 2px offset.

### Chips
- **Style:** pill, 36px minimum, 6px 12px padding, weight 700 at 0.875rem, `surface-2` fill, optional 12px filled glyph (dot, flag, down, star).
- **Tones:** coral and teal use their text partner on a 15 to 16% tint of the hue. Mango keeps body text on a 14% mango tint with a 55% mango border and a mango glyph.
- **As a button:** jump chips move the scrubber; hover draws the border in the current colour, press scales to 0.97. On phones the chip row scrolls sideways; from 640px it wraps.

### Cards / Containers
- **Corner Style:** 22px.
- **Background:** `surface` with a 1px `border`; no blur, no shadow. Inset editors inside a card use `surface-2` at 14px radius with no border.
- **Rows:** settings-style rows are 56px minimum with a hairline between them, label at 700 and value at 800, a chevron that rotates 90 degrees when open.
- **Internal Padding:** 14px to 16px.
- **Variants:** a teal-tinted "best" card (7% teal fill, 35% teal border); a stepped-down card on `bg`; an error notice tinted 9% coral with a 45% coral border.

### Inputs / Fields
- **Text:** 48px minimum, 12px radius, 1.5px `border`, `surface` fill, weight 600.
- **Money:** a 60px (52px small) field at 14px radius with a muted peso sign and the amount at 1.75rem, weight 800, tabular.
- **Focus:** teal border plus the 3px teal field ring; the outline is removed.
- **Error:** coral border, and a 0.875rem coral-text message with a drawn warning triangle.
- **Option pills:** 44px pills with a 1.5px border; the selected one takes a teal border, 16% teal fill and teal text.

### Navigation
- **Wide (1024px and up):** a glass pill bar centred in the top bar. Items are 40px pills, weight 700 at 0.9375rem, muted; hover goes to body text; the current page is a `pill-on` pill with `on-pill` text. Icons are hidden. A muted "Only on this device" note with a lock and a 44px round settings button sit at the right; the settings button takes the same `pill-on` treatment when current.
- **Phone:** a floating tab bar 10px from the screen edges and the safe-area bottom, 24px radius, `glass-solid`, hairline, Float shadow. Five tabs of icon over label (0.8125rem, 700), 58px tall. The current tab's icon sits in a 48 by 28px `pill-on` pill and its label turns body colour.
- **Brand:** the Apo Line mark at 30px with the lowercase wordmark at 1.25rem, weight 800, -0.04em.

### The forecast ridge (signature)
The balance over time drawn as land. The area under the line is filled with the ridge gradient to the bottom of the box; the line is the rim, running edge to edge with flat stubs at both ends, stroked with the rim gradient (sand to mango, left to right). Where the balance is below the safety buffer the rim is redrawn in coral.

- **Scrubber:** a mango scan line at 55% and a 7px mango knob ringed in `ridge-mid`. Dragging or keyboard focus shows a 22% mango halo and grows the knob to 1.15. The whole land is the control: a transparent native range input named "Date" covers it. Touch waits for a horizontal drag so vertical swipes still scroll the page.
- **Reference lines:** safety buffer as a dotted coral-text line at 50%; zero as a muted solid line when the forecast goes negative; today as a short-dash muted vertical; what-ifs as a second, dashed muted line.
- **Month and payday ticks:** drawn on the land on the plot's own scale, not on a separate axis or on the time bar. Month ticks carry a label and thin out (every 1, 2, 3, 4, 6 or 12 months) so labels stay at least 64px apart; a new year is tagged on its first labelled month. Paydays are shorter, fainter unlabelled ticks on the same row.
- **Gipit day:** a coral dot ringed in `ridge-mid` on the rim, labelled under the lowest point, kept 76px from the plot edges.
- **Safety buffer label collision rule:** the label never covers the rim. It tries four positions in order (above the line at the right, above at the left, below at the right, below at the left) and takes the first whose box the rim does not cross. If none is clear, or the plot is too narrow, the label is left out; the dotted line still shows.
- **Reveal:** the land wipes in from the left over 1100ms on `--ease-out`, once per session.

### The far range
A single authored silhouette of the Apo range with haze between its far and mid layers, coloured entirely from scene tokens. It fills the Timeline scene behind the ridge and sits low at half opacity on every other screen. It is never redrawn, animated or made interactive.

### The time bar
A plain transport under the land: a 46px mango play button, a 4px rail with a mango-fading fill, a `pill-on` date handle with a small pointer above the rail, and a 12/24-month segmented toggle. It carries no months, ticks or labels of its own; those belong to the land. Play walks the forecast a day at a time, about ten seconds end to end, and any scrub stops it. Below 560px the toggle is hidden and the rail takes the full bar (the setting lives in Settings). The rail is out of the tab order; the land's "Date" slider is the accessible control.

### The cutoff panel
One translucent pane holding the selected cutoff and "Coming up". Rows are a three-column grid (date, name with optional sub-line, amount). Rows on the selected day take a 14% mango fill with a mango-text date; rows before it fade to 55%. The closing "Left" line sits above a hairline with its amount at 1.125rem, weight 800, coral when under buffer.

### Motion
State changes are 120 to 160ms ease-out (colour, background, press scale). Larger moves use `--ease-out` (`cubic-bezier(0.16, 1, 0.3, 1)`): the ridge reveal, list highlights at 250ms, the play button's 200ms scale. Under reduced motion every animation and transition is cut to effectively zero.

## Do's and Don'ts

### Do:
- **Do** keep the fixed sky and the far range behind every new screen; put content in `surface` cards at 22px radius over it.
- **Do** use `glass-solid` for floating chrome by default and switch to `glass` with blur only inside the 1024px, reduced-transparency-respecting media query.
- **Do** set money figures and page headings thin (230 to 300) at 2.25rem or larger, with tabular figures, and set everything pressable at 600 to 800.
- **Do** pair every signal fill with its text partner (`teal-text`, `coral-text`, `mango-text`) and check both night and day.
- **Do** draw chart labels on the land with `land-label` and the `ridge-mid` halo, and drop a label rather than let it cross the rim.
- **Do** make selection read as `pill-on` on chrome and as mango on the forecast.
- **Do** keep 44px touch targets and the 2px mango focus outline.

### Don't:
- **Don't** use teal, coral or mango as decoration or give them a new meaning; each has one job in the data and one in controls (see the Three Signals Rule).
- **Don't** put `backdrop-filter` on anything at phone or tablet widths.
- **Don't** track tighter than -0.04em, and don't use italics.
- **Don't** put month names, ticks or other chart furniture on the time bar; it is a transport.
- **Don't** paint an opaque full-page background over the sky, or give the day theme a different layout from night.
- **Don't** use mango-coloured text on a mango tint; mango chips keep body text.
- **Don't** fill a destructive button with coral; outline it.
