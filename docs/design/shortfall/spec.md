# Will I make it?

**Slug:** `shortfall`
**Related issues:** Shortfall calculator
**Last updated:** 2026-08-15

---

## Purpose

Answer one anxious question directly: *will my money hold until X?* The user picks either an upcoming bill or an arbitrary date, optionally names a safety cushion they don't want to dip below, and gets a plain-language verdict — covered, or short by a specific amount.

---

## Component inventory

Canonical `shadcn-vue` names. The export's own `data-component` attributes are the source.

| Component | Used for | Status |
|---|---|---|
| Card | The two stacked cards: "ask" card (mode + inputs) and "answer" card (verdict) | **new** — `bunx shadcn-vue@latest add card` |
| Tabs | Ask-mode switch: "Upcoming bill" / "Pick a date" | **new** — `add tabs` |
| RadioGroup | The list of next upcoming bills (one selectable row each) | **new** — `add radio-group` |
| Badge | Verdict pill: "Covered" / "Short" | **new** — `add badge` |
| Label | Field labels for the date and cushion inputs (see Accessibility) | **new** — `add label` |
| Input | Date input (`type="date"`) and safety-cushion input (`type="number"`) | installed |
| Separator | Divides the bill list from the cushion row; divides verdict copy from the stat row | installed |
| Button | Header theme toggle only (export chrome — not part of the screen proper) | installed |

Custom composites to build:

- **BillOptionRow** — a `RadioGroupItem` composed with a two-line label column (bill name + date) and a right-aligned monospace amount. The whole row is the click target, not just the dot.
- **VerdictCard** — `Card` + `Badge` + headline + sub-line + `Separator` + a three-column stat row.
- **StatCell** — uppercase muted label over a monospace value. Reused three times (Today / Lowest point / On).

The header row (← Dashboard link, Mobile/Desktop switch, theme toggle) is export scaffolding for previewing, not part of the screen.

---

## Layout

The content is a **single centered column**, capped on desktop at 640px. On small screens it goes full-width but keeps a **16px side gutter** — never edge to edge. That 16px matches the gutter used at the extreme edges elsewhere in the app, so it stays consistent across screens (Tailwind `px-4`).

### Mobile

Column is capped at 430px and centered. (Mobile screenshots are captured in a 500px viewport — headless Chromium clamps its layout viewport to a 500px minimum, so a narrower capture crops rather than reflows. The symmetric gutters in the images are the capture's, not the design's; the design's own side gutter is the 16px noted above.)

```
┌────────────────────────────────┐
│ Will I make it?                │  title, left-aligned
│ Pick a bill or a date. …       │  muted subtitle
├────────────────────────────────┤
│ CARD — ask                     │
│ [ Upcoming bill │ Pick a date ]│  Tabs, full-width (stretch)
│ ─ bill mode ─                  │
│ (•) Car payment                │
│     Aug 20            -$310    │  ← selected row has accent bg
│ ( ) Car insurance              │
│     Aug 24            -$175    │
│ ( ) … 6 rows total             │
│ ─ date mode ─                  │
│ Date                           │
│ [ 08/29/2026              ]    │  full-width date Input
│ ────────────────────────────   │  Separator
│ Safety cushion         [$ 0]   │  label+help left, Input right
│ The lowest balance you're …    │
├────────────────────────────────┤
│ CARD — answer                  │
│ (Covered)                      │  Badge
│ You're covered.                │  32px headline
│ You'll have $4,886 to spare…   │  muted sub-line
│ ────────────────────────────   │
│ TODAY    LOWEST POINT    ON    │
│ $5,366   $4,886      Aug 20    │
└────────────────────────────────┘
```

Ask card and answer card are separate cards with a 16px gap. Both use 18px/16px padding on mobile.

### Desktop

Column widens to 640px and centers. Beyond max-width:

- Title block **centers** (left-aligned on mobile).
- The mode `Tabs` shrink to their content width and center (`align-self: center`) instead of stretching full-width.
- The answer card **centers its contents** — badge, headline, sub-line, and the stat row all center; mobile left-aligns them.
- Headline scales 32px → 42px; title 24px → 30px; card padding grows.
- Cushion help text fits on one line rather than wrapping to two.

---

## States

Bill mode is the default; the first upcoming bill is preselected. There are only two verdict outcomes — covered and short — driven by whether the projected low point clears the cushion.

### Default — `screens/default.png`
Bill mode, "Car payment · Aug 20 · -$310" selected, cushion `0`. Verdict: **Covered**, "You're covered.", low point $4,886 on Aug 20 against a today balance of $5,366. Cushion `0` means any non-negative low point is covered, so this is the permanently-optimistic starting state.

### Short — `screens/short.png`
Same selection, cushion set to `6000`. Because the projected low point ($4,886) falls below the cushion, the badge flips to **Short**, the headline turns destructive-colored and reads "You need $1,114 more." ($6,000 − $4,886). The stat row is unchanged — the cushion changes the verdict, never the projection.

### Bill later in the list — `screens/bill-later.png`
"Rent · Sep 1 · -$1,650" selected instead. The selection moves the accent-background highlight and filled dot down the list, and the verdict window extends: the sub-line now reads "…through Sep 1." The low point stays $4,886 on Aug 20 — a later target can only ever widen the window, so the low point can move earlier in value but never later than the target.

### Date mode — `screens/date-mode.png`
"Pick a date" tab active. The bill RadioGroup is replaced by a single "Date" label + full-width date Input, defaulted to **today + 14 days** (08/29/2026). Everything below the separator is identical. Verdict recalculates against the chosen date.

### Desktop — `screens/desktop.png`
As described in Layout. Same default data conditions.

### Dark — `screens/dark.png`
Captured with the `.dark` class forced onto `<html>`/`<body>`, because the export's own theme button flips its icon but never applies the class when rendered offline. See Open questions for one real finding this surfaced.

No loading, empty, or error state exists in the export. All three are gaps — see Open questions.

---

## Interactions

- **Mode Tabs** — click "Upcoming bill" / "Pick a date" → swaps the input region between the bill RadioGroup and the date Input → verdict recalculates immediately against the new target. Mode state is independent: switching back restores the previously selected bill, and the date keeps its value.
- **Bill row** — click anywhere on the row (not just the dot) → selects that bill as the target → row gains an `--accent` background and a filled inner dot; the previous row clears → verdict and sub-line date recalculate.
- **Date Input** — change → sets the target date. Bounded: `min` = today + 1 day, `max` = today + 180 days. An empty/cleared value is ignored (the previous date is retained).
- **Safety cushion Input** — change → re-evaluates the verdict. Non-numeric input coerces to `0`. There is no debounce in the export; every keystroke re-renders. Recommend the real implementation update on input with the verdict region in an `aria-live` region.
- **Everything is instant and local.** No submit button, no server round-trip, nothing optimistic. The verdict is a pure function of (target, cushion, projection).

Not visible in a static export: focus rings on the radio rows and both inputs, and the transition when the verdict flips between covered and short — the headline changes both text and color, so it should crossfade rather than snap.

---

## Copy

Exact strings. This screen is copy-heavy and the wording carries the product's voice — reproduce it verbatim.

| Element | String |
|---|---|
| Page title | `Will I make it?` |
| Page subtitle | `Pick a bill or a date. We'll tell you if your cushion holds until then.` |
| Mode tab 1 | `Upcoming bill` |
| Mode tab 2 | `Pick a date` |
| Date field label | `Date` |
| Cushion label | `Safety cushion` |
| Cushion help | `The lowest balance you're comfortable letting it reach.` |
| Badge (covered) | `Covered` |
| Badge (short) | `Short` |
| Headline (covered) | `You're covered.` |
| Sub-line (covered) | `You'll have {margin} to spare above your cushion through {date}.` |
| Headline (short) | `You need {amount} more.` |
| Sub-line (short) | `to keep {cushion} in reserve through {date}.` |
| Stat labels | `Today` · `Lowest point` · `On` (rendered uppercase via text-transform — keep the sentence case in source so screen readers don't spell them out) |

Notes on the copy:

- The **short** sub-line is a deliberate lowercase sentence fragment that continues the headline: "You need $1,114 more." / "to keep $6,000 in reserve through Aug 20." Read together they form one sentence. Don't "fix" the capitalization — but the two halves must stay visually adjacent for it to parse, which constrains any future layout change.
- Bill row dates format as `Mon D` (e.g. `Sep 1`). The row template appends ` · Today` when a bill lands on the current day, but the bill list only includes offsets ≥ 1, so that suffix is currently unreachable.
- The "On" stat appends ` (today)` when the low point is today.
- Amounts render with a typographic minus and no cents: `-$1,650`.

---

## Token usage

Named tokens only.

- **Surfaces** — page `--background`; both cards `--card` with a 1px `--border` and `--radius`.
- **Text** — `--foreground` for the title, bill names, amounts, and stat values; `--muted-foreground` for the subtitle, bill dates, cushion help, stat labels, the verdict sub-line, and the inactive mode tab.
- **Mode Tabs** — track `--accent`; active tab fill `--primary` with `--primary-foreground` text.
- **Bill rows** — selected row background `--accent`; selected radio dot border and fill `--primary`; unselected dot border `--input`.
- **Inputs** — 1px `--input` border, `--background` fill, `--foreground` text. The `$` prefix is `--muted-foreground`.
- **Verdict — covered** — badge text `--chart-positive`, badge background that same color mixed 16% into transparent. Headline uses plain `--foreground`.
- **Verdict — short** — badge text and headline both `--destructive`, badge background `--destructive` mixed 16% into transparent.
- **Typography** — `--font-sans` throughout, except every money figure and the date input, which use `--font-mono`.

Three token gaps this screen depends on — all detailed under Open questions: `--chart-positive` does not exist in the repo, there is no mono token, and the design's typeface is Geist/Geist Mono against the repo's Figtree.

---

## Accessibility notes

- **Focus order**: mode Tabs → (bill RadioGroup as a single tab stop, arrow keys to move within it | date Input) → cushion Input. The verdict card is not interactive.
- **The bill list must be a real RadioGroup.** The export renders `<label>` elements with hand-drawn dot `<span>`s and no `<input type="radio">` at all — there is nothing for a screen reader or the keyboard to operate. The real implementation needs `RadioGroup`/`RadioGroupItem` with a group label ("Upcoming bill" or an sr-only "Which bill?"), and each item's accessible name must include the amount and date, not just the bill name — "Car payment, Aug 20, minus $310".
- **Both inputs need associated labels.** "Safety cushion" and "Date" are plain `<div>`s in the export. Use `Label` with `for`/`id`. The `$` prefix is decorative — `aria-hidden`, with the currency conveyed in the input's accessible name instead.
- **Announce the verdict.** The badge/headline/sub-line region changes as the user types in the cushion field, with no focus movement. Wrap it in `aria-live="polite"` so the answer reaches a screen-reader user, and keep the wording self-sufficient (the headline alone states the outcome).
- **Color is not the only signal** — the covered/short distinction is carried by the badge *text* as well as its color, which is correct. Preserve that; never reduce the badge to a colored dot.
- **Touch targets**: bill rows are ~48px tall including padding — fine. The cushion input is only 78px wide; on mobile it should grow or the whole wrap should be the tap target so the field isn't hard to hit.
- The typographic minus in `-$310` should be a real minus sign for screen-reader pronunciation, or the accessible name should say "minus".

---

## Domain-engine boundary

The export computes everything inline in its script block: it builds a 215-day balance series from seeded accounts, monthly bills, a biweekly paycheck anchor, and a flat daily discretionary spend; derives the list of upcoming bills from that series; then finds the minimum balance in the window from today to the target.

**None of this belongs in the component.** The component receives a target (bill id or date) and a cushion, and renders a verdict. The engine owns:

- Projecting the combined balance series across accounts.
- Deriving "next bills" — currently: negative-amount events only, within the next 120 days, deduplicated by label, sorted by date. Each of those three rules is a product decision that should be explicit and tested in the domain layer.
- Finding the minimum point in `[today, target]` and returning its value and date.
- Computing `margin = lowPoint − cushion` and the covered/short determination.

Money is integer cents in the engine and formatted only at the edge; the export's floating-point dollars are a prototype artifact.

---

## Open questions

1. **`--chart-positive` does not exist in this repo.** The "Covered" badge is the design's only use of it here, and there's no equivalent token in `tailwind.css` — `--destructive` covers the negative side but positive has nothing. Needs a real token before this screen can be built; the whole point of the screen is a green/red verdict.
2. **No mono token.** Every money figure and the date input specify `--font-mono`. The repo has `--font-sans: Figtree` and no mono at all, so the tabular alignment of the stat row and the bill amounts has nothing to map to. Also note the design loads Geist + Geist Mono, not Figtree — a broader typeface mismatch than this screen alone.
3. **Dark mode: the selected mode tab loses the blue primary fill — confirmed real.** In dark, "Upcoming bill" renders as a light grey/near-white pill with dark text rather than the brand blue of light mode, because the design system's dark `--primary` is a near-white. It is *not* a contrast failure (dark-on-light reads strongly, and the selected/unselected distinction survives), but it is a brand-identity inconsistency: the same control is blue in light and grey in dark. Decide whether `--primary` should keep its hue in dark, or whether the selected tab should use a different token. Same question applies anywhere else a primary-filled control appears.
4. **Desktop tab wrapping.** At 640px the centered mode Tabs shrink to content width and "Upcoming bill" wraps onto two lines, making the two tabs unequal in height. Needs a `white-space: nowrap` or a min-width.
5. **Cushion input is unbounded.** No min, max, or step. Negative values are accepted and would make the verdict trivially "covered". Should it clamp at 0, and should it have a sensible max?
6. **Date mode can't select today.** `min` is today + 1 while bill mode clamps the target offset to ≥ 0, so "will I make it through today?" is answerable in one mode and not the other. Probably intentional, but the two modes should agree.
7. **No empty state.** If a user has no upcoming bills, the bill mode RadioGroup has nothing to render and the default selection has nothing to point at. The export always seeds six bills so this is unreachable, and no copy exists for it. Likely resolution: hide or disable the "Upcoming bill" tab and default to date mode.
8. **No loading or error state.** The projection is computed locally and instantly in the export. If the real projection is async or can fail, both states need designing — particularly what the verdict card shows while the answer is unknown.
9. **The 120-day / deduplicate-by-label bill window is undocumented product logic.** Only the *next* occurrence of each recurring bill appears, so a user looking 6 months out sees the same six rows. Confirm that's intended.
