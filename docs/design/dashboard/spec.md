# Burndown dashboard

**Slug:** `dashboard`
**Related issues:** Burndown chart, Dashboard
**Last updated:** 2026-08-15

---

## BLOCKING DECISION — max-width conflict

**This screen's layout contradicts every other screen's, and the shell layout cannot be written
until someone picks a side.**

Every other screen in this design is a single centred column capped at **640px** (480px for first
run), full-width with a 16px gutter below that. The dashboard's own layout code caps content at
**1160px** and, above the breakpoint, becomes a two-column grid
(`"chart stat" / "events events"`, second column fixed at 340px). It is the only screen that does
this. Whatever container the app shell provides, one of these two is wrong.

**Resolution A — the shell caps at 640px; the dashboard conforms.**
The chart, stat card and Upcoming list stack in one column at every width, exactly as they do on
mobile. Cost: the desktop dashboard becomes a tall single column, so the chart is ~640px wide
instead of ~780px and the stat card no longer sits beside it — the two things a user compares
(the forecast line and the lowest-balance verdict) stop being visible together on a wide screen.
The Upcoming list also gets a much longer scroll. This is the cheapest option to build and the one
that keeps the shell honest, but it throws away the only layout in the design that uses a desktop
viewport for anything.

**Resolution B — the shell allows a wider container; the dashboard keeps its grid.**
The shell exposes a width variant (a `max-w-screen-*` prop or a per-route layout) and the dashboard
opts into the wide two-column form. Cost: two container widths to maintain and test, both themes ×
both widths; every future screen has to choose one; and the 640px cap stops being a rule the shell
enforces and becomes a convention each page can opt out of. It also introduces a genuine breakpoint
to the app — the only one — with the responsive grid, the taller chart viewBox (460 vs 400) and the
Sheet→Dialog component swap all firing at it, so that breakpoint value has to be agreed and shared
rather than hardcoded per screen.

Both are defensible. **I am not resolving this** — it needs a product/architecture call before the
layout component is written, because retrofitting either direction touches every screen.

---

## Purpose

The home screen. It answers "how far does my money go, and when does it get uncomfortable?" — a
balance forecast line from two weeks back through the chosen horizon, the single lowest point
that forecast reaches, and the list of everything due to hit the accounts between now and then.

---

## Component inventory

Canonical `shadcn-vue` names. The export tags its own intent with `data-component`; this table
follows those tags.

| Component | Used for |
|---|---|
| Card | Chart card, lowest-balance stat card, Upcoming card, and the density popover panel |
| Badge | Status pill in the stat card (`Covered` / `Tight` / `Short by $X`) |
| Alert | Destructive-tinted shortfall message inside the stat card |
| Separator | Under the Upcoming card title; above the day-detail item list |
| Table | Upcoming occurrence list (rendered as a grid of rows, not a `<table>`) |
| ToggleGroup | Horizon selector (30d / 60d / 90d); scope selector in the edit form |
| Checkbox | Per-account series toggles in the chart legend |
| Slider | Line weight / dash density / marker size in the chart-density panel |
| Switch | "What-if mode" toggle in the day-detail editor |
| Input | Amount (`number`) and Date (`date`) in the edit-occurrence form |
| Popover | Safety-cushion explainer, anchored to the cushion line |
| Sheet | Day-detail editor on mobile |
| Dialog | Day-detail editor on desktop (same content, different container) |
| Button | Density button, sheet close, Cancel / Save change, Done |
| Skeleton | Chart placeholder during the initial load |

Custom components (not shadcn primitives):

- **BurndownChart** — the inline SVG. The export tags `ChartContainer`, `ChartTooltip` and
  `ChartCrosshair`; there is no shadcn-vue chart primitive in the registry, so this is a bespoke
  component composed of an SVG plus a Card-styled tooltip and a `Popover`.
- **AccountLegendRow** — Checkbox + colour swatch + name + trailing balance.
- **OccurrenceRow** — date / label+account / amount grid row, reused by Upcoming and by the
  day-detail item list.

Already installed in the repo: button, input, separator, sheet, skeleton (plus avatar, breadcrumb,
dropdown-menu, sidebar, tooltip). **New installs needed:** `card`, `badge`, `alert`, `table`,
`toggle-group`, `checkbox`, `slider`, `switch`, `dialog`, `popover`.

> The "Mobile / Desktop" tab pair and the theme button in the export header are prototype chrome,
> not part of the screen. Do not build them.

---

## Layout

### Mobile

```
┌ Runway wordmark (dot in --chart-1) ──────────┐
├ Card: Balance forecast ──────────────────────┤
│  title + "14 days back · N days ahead"       │
│  right: ToggleGroup 30d|60d|90d  [⚙]         │
│  (optional) density panel                    │
│  SVG chart                                   │
│  ─────────────────────────────────           │
│  legend: [x] Checking $3,639  [x] Savings …  │
│          — Combined                          │
├ Card: LOWEST PROJECTED BALANCE ──── [Badge] ─┤
│  $4,886                                      │
│  Aug 20 · in 5 days                          │
│  (Alert, only when short)                    │
│  Will I make it? →                           │
├ Card: Upcoming ──────────────────────────────┤
│  subtitle · Separator                        │
│  date | label / account | amount   (×14 max) │
└──────────────────────────────────────────────┘
```

Single centred column, full-width with a 16px side gutter (Tailwind `px-4`) — never edge to edge.
Cards stack with a 14px gap; card padding is 18px/16px.

### Desktop

Two-column CSS grid, `grid-template-areas: "chart stat" / "events events"`, second column fixed at
340px, 20px gap, 40px side padding. Card padding grows to 22px/24px. The chart SVG gets taller
(460 vs 400 viewBox units).

**Deviation:** the shared responsive rule is a single centred column capped at 640px, and this
screen does not follow it. See **BLOCKING DECISION — max-width conflict** at the top of this spec;
do not build the layout from this section until that is settled.

---

## States

> **Capture widths.** Mobile shots are 500px wide (headless Chromium clamps its layout viewport to
> a 500px minimum, so a narrower request renders at 500 and crops, pushing the column off-centre);
> the Sheet/Dialog overlay states are 520px (fixed-position layers are offset by the harness and
> clip at narrower widths); desktop shots are 1100px. The inconsistency is deliberate, not accidental.

### Default — `screens/default.png`
30-day horizon, both accounts selected, seeded data. Combined line plus one line per account;
lowest projected balance `$4,886` on `Aug 20`, badge `Covered`, nine upcoming rows.

### Loading — not captured
`componentDidMount` sets `loading: true` and clears it after 550ms. While true the whole chart area
is replaced by a shimmering skeleton block at the chart's exact height (400 mobile / 460 desktop);
the card header, horizon toggle, legend and both other cards stay rendered. The offline export runs
past 550ms before the screenshot is taken, so this state could not be photographed — it is
documented from the state machine only. Build it with `Skeleton`, not a custom shimmer.

### Covered — `screens/default.png`
`lowest − cushion ≥ 250`. Badge `Covered` in the positive colour; no Alert.

### Tight — `screens/tight.png`
`0 ≤ lowest − cushion < 250`. Badge `Tight` in the warning/amber colour, headline still in
`--foreground`, no Alert. Reached by editing the Aug 20 Car payment occurrence to `-4496`.

### Short — `screens/short.png`
`lowest < cushion`. Badge reads `Short by $1,404`, the headline number turns `--destructive`
(`-$804`), and the Alert appears. Reached by editing the same occurrence to `-6000`.
Note this is also the *negative balance* case: Checking closes the window at `-$2,051`. There is no
separate treatment for crossing zero — the only banded region is the danger zone **below the safety
cushion**, so a negative balance is just "further into the same band". Flagged under Open questions.

### Empty — not reachable
The export always seeds two accounts and seven recurring items, so the no-data dashboard cannot be
rendered and the design specifies no copy for it. It is nevertheless required: First run offers
"Skip to dashboard", which lands a user here with nothing. See Open questions.

### Error — not specified
The design has no error state for a failed projection or load.

### Horizon 90d — `screens/horizon-90.png`
`60d`/`90d` widen the window and change the x-tick step (7d ≤30, 14d ≤60, 21d otherwise). The
subtitle becomes "14 days back · 90 days ahead" and the Upcoming subtitle "…through 90 days". The
Upcoming list is hard-capped at **14 rows** with no "show more" affordance.

### Single account — `screens/single-account.png`
One account deselected. The Combined line and its legend entry disappear, the remaining line takes
the full stroke weight, the lowest point recomputes against that account alone (`$1,682`), and the
Upcoming list drops that account's rows. The last selected account cannot be deselected — the
toggle is a no-op when it would clear both.

### Chart density panel — `screens/chart-density.png`
The ⚙ button opens an inline Card above the chart with three Sliders: Line weight (4–14, default 8),
Dash density (3–18, default 7), Marker size (0.6–1.8 step 0.1, default 1.0). Values echo to the
right of each label.

### Safety-cushion popover — `screens/cushion-info.png`
Tapping the cushion label opens a Popover pinned just above the cushion line.

### Day detail (mobile Sheet) — `screens/day-detail.png`
Tapping a chart day or an Upcoming row opens a bottom Sheet titled "Day detail" with the date
beneath, a What-if switch, and the list of that day's occurrences (label / account / amount /
chevron), then a primary "Done".

### Day detail (desktop Dialog) — `screens/day-detail-dialog.png`
**Same content, different container.** On desktop the editor is a centred 400px `Dialog`; on mobile
it is a bottom `Sheet` with a drag handle. The export switches `data-component` between the two, so
this is a component swap at the breakpoint, not a CSS restyle.

### Edit occurrence — `screens/edit-occurrence.png`
Tapping an item swaps the list for a form: the item name, Amount (`$` prefix) and Date side by side,
an "Applies to" ToggleGroup, then Cancel / Save change. The sheet title changes to "Edit occurrence".

### What-if — `screens/what-if.png`
The switch turns amber; the chart card border becomes a dashed amber outline, a banner appears at
the top of the chart card and another inside the sheet, and the save button turns amber and relabels
to "Preview change". Edits go to a separate override list that is discarded when the sheet closes.

### Dark — `screens/dark.png`
Same layout on the dark palette. **Captured by forcing `.dark` on `<html>`/`<body>`** — the export's
own theme button flips its icon but never puts the class on the DOM when rendered offline.

---

## Interactions

- **Horizon ToggleGroup** — tap `30d`/`60d`/`90d` → refetch/recompute the window → chart, subtitles,
  lowest point and Upcoming list all update; any hover state is cleared.
- **Account checkbox** — tap → that series and its markers are added/removed, the Combined line
  appears only when 2+ are selected, the lowest point and Upcoming list recompute. Deselecting the
  last remaining account is rejected silently; it should be a disabled control instead.
- **Legend balance** — read-only; shows each account's balance at the *end* of the visible window,
  not today's balance.
- **Chart hover (pointer)** — invisible per-day hit rects fire on `mouseenter` → a vertical crosshair
  is drawn at that day and a tooltip appears showing the date (suffixed `· Today` at offset 0), one
  row per visible series, and, when that day has occurrences, a separator plus each item and amount.
  The tooltip flips to the left of the cursor once past 60% of the chart width. Cleared on
  `mouseleave` of the chart. *Not capturable in the static export — the driver dispatches synthetic
  clicks only.*
- **Chart tap (touch)** — the same hit rects also carry a click → opens the day-detail editor for
  that day. Tap and hover are two different outcomes on the same target; on touch there is no hover,
  so the tooltip content must also be reachable from the sheet.
- **Upcoming row** — tap anywhere on the row → opens the day-detail editor for that row's day.
- **Safety-cushion label** — tap → toggles the explainer Popover.
- **Density ⚙** — toggles the slider panel; the button takes an accent fill while open. Sliders are
  live (no apply step). These are presentation-only and persist nothing.
- **What-if switch** — on → edits are previewed, not saved; the save button becomes "Preview change".
  Off → the what-if override list is emptied and the chart snaps back.
- **Save change / Preview change** — writes an override `{label, account, scope, offset, newOffset,
  amount}` into either the saved list or the what-if list, then returns to the item list.
  "This occurrence only" moves/retimes that single event; "Apply to all future" rewrites the amount
  on every occurrence at or after that date (and ignores the date field).
- **Cancel** — returns to the item list, discards the form.
- **Close ✕ / overlay tap / Done** — closes the editor **and** turns what-if off, discarding all
  what-if overrides. There is no confirmation.
- **"Will I make it? →"** — navigates to the shortfall screen.

Not visible in a static export: the tooltip and crosshair, the 550ms skeleton→chart swap, and focus
styles (the export defines none).

---

## Copy

- Chart card title: **Balance forecast**
- Chart card subtitle: **14 days back · {30|60|90} days ahead**
- Horizon labels: **30d**, **60d**, **90d**
- Density panel: **Line weight**, **Dash density**, **Marker size**
- Chart annotations: **Today**, **Safety cushion · $600**, **Lowest · {date}**
- Cushion popover: **The lowest balance you're comfortable letting your account reach — dips below
  this are flagged as danger zone.**
- Legend: account names, plus **Combined**
- Stat card eyebrow (uppercase): **Lowest projected balance**
- Status badge: **Covered** / **Tight** / **Short by {amount}**
- Stat meta: **{date} · in N days** (singular "in 1 day"; **projected today** when the low point is
  today or earlier)
- Shortfall alert: **Projected to dip {amount} below your safety cushion on {date}.**
- Link: **Will I make it? →**
- Upcoming card: **Upcoming** / **Everything hitting your accounts through {30|60|90} days**
- Date column suffix on today's rows: **{date} · Today**
- Editor titles: **Day detail** → **Edit occurrence**; subtitle is the date.
- What-if: **What-if mode** / **Try changes and watch the chart react, without saving**
- What-if banners: **◑ Previewing what-if — not saved** (chart card) and
  **◑ What-if — changes here won't be saved** (editor)
- Edit form: **Amount**, **Date**, **Applies to**, **This occurrence only**,
  **Apply to all future**, **Cancel**, **Save change** (→ **Preview change** in what-if)
- Editor day with nothing on it: **No scheduled bills or income land on this day.**
- Editor primary: **Done**

---

## Token usage

- Surfaces: `--card` on all four cards and the tooltip/popover/editor; `--background` on the page,
  on the amount/date inputs, and as the fill of hollow event markers; `--foreground` for headings,
  amounts and the Today rule; `--muted-foreground` for subtitles, axis labels, meta rows and the
  cushion line and label.
- Borders: `--border` for card borders, separators, gridlines and row rules; `--input` for the form
  field borders, the unchecked checkbox border and the off state of the what-if switch.
- `--accent` behind the ToggleGroup and Tabs tracks and the density panel; the selected segment is
  filled with `--card` (segmented control) except the horizon group, which fills with `--primary` /
  `--primary-foreground`.
- `--primary` for the "Will I make it?" link, the Done/Save buttons and the slider accent colour.
- `--destructive` for the short headline, the `Short by` badge, the lowest-point marker ring and
  amount label, and the Alert (tinted at 10% fill / 30% border).
- Chart series: `--chart-1` combined line and the brand dot; `--chart-3` Checking; `--chart-4`
  Savings. `--chart-2` is unused here but is offered as an account colour on the accounts screen.
  `--chart-5` is reserved for what-if: the dashed card outline, both banners, the switch fill, the
  Preview-change button, and the `Tight` badge.
- `--radius` on cards; the smaller controls use fixed 7–12px radii that should map onto
  `--radius-sm`/`--radius-md`/`--radius-xl` rather than being hardcoded.

Not covered by the repo's token set (see Open questions): `--chart-positive` / `--chart-negative`,
the green/amber chart palette, and the monospace face.

---

## Accessibility notes

- **Chart equivalent.** The SVG carries the whole answer visually. It needs `role="img"` plus a
  summary description ("Balance forecast, Aug 1 to Sep 14. Lowest projected balance $4,886 on
  Aug 20, above your $600 safety cushion."), and the per-day detail must be reachable without a
  pointer. The Upcoming card is most of that equivalent already; the remaining gap is the daily
  balance series and the "below cushion" banding, which nothing currently states in text.
- **Hover-only content.** The tooltip is the only place daily balances appear. Touch users reach the
  day editor instead, which shows the day's occurrences but *not* the running balances — the day
  editor should show them too so no information is pointer-exclusive.
- **Day hit targets** are transparent `<rect>`s with a click handler and no focusability. Give the
  chart a focusable wrapper with left/right arrow key navigation between days, announcing date +
  balance, and Enter to open the day.
- **Legend checkboxes** are `<span>`s in a `<label>`, not inputs. Use a real Checkbox with an
  accessible name of "Show {account} on the chart"; announce the trailing balance as part of the
  label or with `aria-describedby`.
- **What-if switch** is a `<button>` with no `role="switch"` / `aria-checked` and its only label is
  adjacent text — wire the label with `aria-labelledby` and expose the checked state.
- **Sliders** need visible `<label for>` associations and `aria-valuetext` (the value is echoed
  visually only).
- **Icon-only buttons:** the density ⚙ has `aria-label="Chart density"`; the sheet close ✕ has none
  and needs "Close".
- **Colour alone** distinguishes income (positive colour) from bills; the `+`/`−` sign must stay.
  The `Covered`/`Tight`/`Short` badge is text, which is correct — keep the text, not just the tint.
- **Touch targets:** legend checkbox 18px, close button 28px, density button 30px, per-day hit rect
  ≈8px wide at mobile on a 30-day window (narrower at 90 days). All below the 44px minimum; the day
  rects in particular are not a usable touch target and the tap-to-open-day interaction should move
  to the marker dots or the Upcoming list.
- Focus order: horizon group → density → chart → legend checkboxes → "Will I make it?" → Upcoming
  rows. Opening the Sheet/Dialog must trap focus and restore it to the trigger row on close.

---

## Added since the export — awaiting design

One piece of this screen is **not in the design** and is not derived from it. It is described here
rather than only in a pull request so the next person reading this spec sees the screen that exists.

### Stale-balance alert — `app/components/dashboard/StaleBalancesAlert.vue`

An amber `Alert` above the chart, shown only when the accounts' `balanceAsOf` dates disagree. It
names the accounts that are behind, says how far, and offers one **Update balances** button that
opens an editor prefilled with *every* account.

**Why it exists.** A stored balance is true as of its own day and already contains everything up to
it, so a chart built from a reading taken today and one taken three weeks ago is adding a fresh
number to a stale one. Recording a transfer between two such accounts moves the combined line —
correctly, and bafflingly, because the transfer is inside one reading and not the other. The
projection engine's property tests are what surfaced this; the design predates them.

**What it borrows rather than invents.** The `Alert` primitive is already in the component
inventory, and `--chart-warning` is the token the `Tight` verdict carries — amber rather than
destructive on purpose: nothing is broken and nothing was lost, the forecast is just less
trustworthy than it looks. No new token, no new component.

**The three judgment calls, all open to a second opinion:**

1. **The copy.** "Some balances are older than others", then which accounts and by how much.
2. **The placement**, above the chart rather than inside the card or beside the legend. The
   reasoning: everything below it is derived from the readings it is warning about.
3. **Prefilling every account, not only the stale ones.** Re-typing only the stale balance leaves
   the user asserting that a number they never checked is still true. The counter-argument — that
   it asks for more work than the problem needs — is real, and this is the call most worth
   revisiting.

**To see it**, give two accounts different "Balance as of" dates on `/accounts`. No seeded household
carries a stale reading, so it never appears on a fresh load.

---

## Open questions

1. **Chart palette mismatch.** The design's `--chart-1`/`--chart-2` are greens, `--chart-3`/`-4`
   blues, `--chart-5` amber. The repo's `--chart-1`…`--chart-5` are all blue. Every green on this
   screen (combined line, brand dot, positive amounts) and every amber (what-if, `Tight` badge)
   comes out blue against the current tokens.
2. **No positive/negative chart tokens.** The design uses `--chart-positive` for income amounts and
   the `Covered` badge and `--chart-negative` for the danger-zone fill. Neither exists in the repo.
   `--destructive` is the closest match for negative; positive has no equivalent at all.
3. **No monospace token.** Every balance, amount, tooltip value and slider readout is set in
   `--font-mono`. `--font-sans` is Figtree and there is no mono token; the design also assumes
   Geist/Geist Mono. Needs a decision before any figure is styled.
4. **Max width — see BLOCKING DECISION at the top of this spec.** The most consequential open item
   on this screen; it is stated in full there rather than in this list.
5. **No empty state.** First run offers "Skip to dashboard", so a user can arrive with zero accounts
   and zero recurring items. The design has no copy, no illustration and no call to action for that.
   Cross-screen; needs a decision with the first-run screen.
6. **No error state** for a projection that fails to load.
7. **Zero crossing.** The only banded region is *below the safety cushion*. A balance that goes
   negative gets no distinct treatment, and the y-axis has no emphasised zero line. Should crossing
   zero read differently from crossing the cushion?
8. **Where does the safety cushion come from?** It is a hardcoded $600 here, and the shortfall screen
   has its own editable "Safety cushion" input. Is it one shared setting, and is it editable from
   this screen?
9. **"Save change" has no home.** Saved overrides mutate the projection permanently with no toast,
   no undo, and no indication afterwards that a projected occurrence was overridden. Does an
   override become a real edit to the recurring item, or a one-off exception record?
10. **"Apply to all future" ignores the date field** — it only rewrites amounts. If a user changes
    both amount and date and picks "all future", the date change is silently dropped.
11. **Upcoming is capped at 14 rows** with no "show all", so at 60/90 days the list is a truncated
    view of a window the chart shows in full, with nothing saying so.
12. **What-if is discarded on close** without confirmation, including when the user taps the overlay.
13. **Discretionary spend** is a flat −$34/day applied to Checking with no UI anywhere on this
    screen — it is not in the legend, the tooltip, or the Upcoming list, yet it dominates the slope.
    Should it be visible/adjustable here?

    **Resolved (issue #4), on the arithmetic half only.** The flat daily rate is an observation
    about the prototype export, not a requirement. The engine holds the figure the user can
    actually state — a *monthly* amount — and divides it by the length of the month each day falls
    in, so a day in February costs more than a day in March and every month drains exactly what was
    stated. A flat `monthly × 12 ÷ 365` under-drains February by ~10%, and under-draining is the
    direction that matters: it reports a higher low point than reality, which is the app saying
    "you're covered" about a month the user is not. Read the −$34/day as the prototype's rounding of
    a ~$1,034/month figure, not as a spec of the daily rate. See `domain/discretionary.ts`.

    **Still open:** whether the drain should be *visible* on this screen — in the legend, the
    tooltip, or Upcoming — and whether it is adjustable from here. Nothing below has changed that.

---

## Notes for implementation

**The projection arithmetic does not belong in the component.** The export computes everything
inline in its script block: day-by-day balance accumulation from a start balance, monthly bills by
day-of-month, biweekly paycheck by modulo against an anchor date, a flat daily discretionary
deduction, override application (once vs. all-future), the running combined series, the lowest
future point, and the status thresholds. All of that goes in the domain engine and is unit-tested
there; the dashboard component receives a computed series plus a status verdict and renders it.

Specifics the engine owns:

- Window is `today − 14` through `today + horizon`, inclusive, one point per day.
- The lowest point is searched over **strictly future** days (offset ≥ 1), against the combined
  series when more than one account is selected, otherwise that account's series.
- Status thresholds on `margin = lowest − cushion`: `≥ 250` Covered, `≥ 0` Tight, `< 0` Short.
  The 250 boundary is a product rule, not a rendering detail.
- Money is held as integer cents and formatted only at the edge; the export's floating-point
  accumulation must not be copied.
- Chart geometry (scales, ticks, paths) is view logic and may live in a composable beside the
  chart component — but it must consume the engine's series rather than build one.

**Export rendering caveats.** Interpolated text inside SVG `<text>` does not render in the offline
export, so the axis tick labels, the "Safety cushion · $600" label, the "$4,886" lowest-point label
and the date after "Lowest ·" are missing from every screenshot. Their values are taken from the
export's own code and are listed under Copy. Capture widths vary by state for harness reasons — see
the note at the top of the States section.
