# First run (onboarding)

**Slug:** `first-run`
**Related issues:** First-run experience
**Last updated:** 2026-08-15

---

## Purpose

The first thing a new user sees. It asks for the two facts Runway needs to draw anything — one
account balance and one recurring bill or paycheck — and then hands the user straight to their
first projection. The promise it makes up front is "See how far your money goes."

---

## Component inventory

| Component | Used for | Status |
|---|---|---|
| Card | The step card (steps 1 and 2) and the done card | installed |
| Input | Name (text), Balance and Amount (number), As of and Next occurrence (date) | installed |
| Button | Continue, Back, Build my runway, colour swatches, See your runway | installed |
| Label | Field labels (Name, Line color, Balance, As of, Amount, Cadence, Next occurrence) | **new** — `bunx shadcn-vue@latest add label` |
| Tabs | Bill / Income type switch on step 2 | **new** — `add tabs` |
| Select | Cadence (Weekly / Biweekly / Monthly) | **new** — `add select` |

The export marks the Bill/Income switch `data-component="Tabs"`. It renders as a segmented control
(two equal-flex buttons in an `--accent` track, the active one filled with `--card` plus a small
shadow). `ToggleGroup` with `variant="outline"` is the closer visual match; either is defensible,
but keep it consistent with the same control on the recurring-items screen. Flagged under Open
questions.

Custom components (not shadcn primitives):

- **StepProgressDots** — two `<span>` pills. Composed from nothing; a `v-for` over step count with
  a width transition. See Interactions.
- **ColorSwatchPicker** — a row of three round buttons, each a `--chart-N` fill with a ring when
  selected. Shared with the accounts and recurring-items editors; build once.
- **ChartPlaceholder** — dashed-border box with a caption and a dashed horizontal rule standing in
  for the runway line. Onboarding-only.
- **AppHeader (onboarding variant)** — "Runway" wordmark plus a "Skip to dashboard" link. The
  Mobile/Desktop toggle and the theme button in the screenshots are the export's own preview
  chrome and are **not** part of the screen.

---

## Layout

Single centered column. On desktop it is capped at **480px** — deliberately narrower than the
640px used on every other screen, because this is a focused one-thing-at-a-time flow. On small
screens the column goes full width but keeps a **16px side gutter** (Tailwind `px-4`), matching
the gutter used at the extreme edges elsewhere, so it never runs edge to edge.

### Mobile

Full-width column with a 16px side gutter (`px-4`), never edge to edge. The column caps at 430px,
so on anything narrower — 375px included — it is simply full-width minus the gutter.

The screenshots in `screens/` are captured at 500px wide because headless Chromium clamps its
layout viewport to a 500px minimum. The wide gutters visible in those images are an artifact of
the capture, not the design; the design's own gutter is the 16px above.

```
Runway                          Skip to dashboard   <- header
─────────────────────────────────────────────────
        See how far your money goes.              <- hero (step 1 only)
   Add one account and one bill or paycheck,
     and Runway builds your first projection.

┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐   <- chart placeholder
      Your runway chart appears here              (step 1 only)
  - - - - - - - - - - - - - - - - - - - - -
└ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘

                 ▬  ·                             <- progress dots
┌───────────────────────────────────────────┐
│ STEP 1 OF 2                                │
│ Add your first account                     │
│ Runway needs one account balance to…       │
│ Name        [                            ] │
│ Line color  ( ) ( ) ( )                    │
│ Balance [$    ]   As of [ 08/15/2026     ] │   <- two columns, equal
│ [            Continue                    ] │   <- full-width primary
└───────────────────────────────────────────┘
```

Step 2 replaces the card body and **drops the hero and the chart placeholder entirely** — from
step 2 onward the column starts at the progress dots. The done state does the same.

### Desktop

Column max-width 480px, centered; card padding grows from `18px` to `22px 24px`; hero title steps
up one size. Nothing reflows — the Balance/As-of and Amount/Cadence pairs are side by side at
every width.

Note the export gives the **header** a max-width of 640 while the content column is 480, so on
desktop the header is visibly wider than the card beneath it. Treat that as unintentional and
align both at 480 unless told otherwise (Open questions).

---

## States

### Step 1 (default) — `screens/step-1.png`

The screen's entry state. Hero + chart placeholder + step-1 card. Name is empty, so **Continue is
disabled**. Balance defaults to `0`, As of defaults to today, and the first colour swatch
(`--chart-2`) is preselected.

### Step 1, valid — `screens/step-1-valid.png`

Name has been typed ("Checking"); Continue is enabled. Nothing else changes.

**Discrepancy:** the export renders the disabled and enabled Continue identically — it sets the
`disabled` attribute but ships no disabled styling. The implementation must add the standard
shadcn disabled treatment (reduced opacity, `cursor: not-allowed`), otherwise the gate is
invisible and the button looks broken when tapped.

### Step 2 — `screens/step-2.png`

Hero and placeholder are gone. Bill/Income tabs default to **Bill**; Name placeholder reads
"e.g. Rent". Amount `0`, Cadence "Monthly", Next occurrence today. "Build my runway" is disabled
until Name is non-empty. "Back" is always enabled.

### Step 2, income — `screens/step-2-income.png`

Income tab selected; the only change is the Name placeholder → "e.g. Paycheck". No other field
differs. Unlike the recurring-items editor there is **no** "Amount source" / predicted-income
option here — onboarding always captures a fixed amount.

### Done — `screens/done.png`

Reached by submitting step 2. Single centered card: "You're set.", a summary sentence generated
from what was entered, a full-width "See your runway" link-button, and a footnote. Both progress
dots are filled `--primary` and neither is widened.

### Desktop — `screens/desktop.png`

Step 1 at the desktop breakpoint.

### Dark — `screens/dark.png`

Step 1 in dark. Captured by setting the `.dark` class directly on `<html>`/`<body>` — the export's
own theme button flips its icon but never applies the class when rendered offline, so this is the
palette, not the export's toggle. Worth noting: `--primary` in dark is near-white, so the Continue
button and the active progress dot render light-on-dark rather than blue. That is the expected
shadcn dark behaviour, not a bug, but it means the "brand blue" of the light theme has no dark
counterpart anywhere in this flow.

### Loading / Empty / Error

None. There is no server round-trip in the design — every transition is local state — and the
screen is itself the empty state of the app.

---

## Interactions

- **Name (step 1)** — type → trims and compares to empty → Continue enables/disables live on every
  keystroke. Whitespace only does not count as valid.
- **Line color swatch** — tap → sets the account's chart colour → the selected swatch gains a
  2.5px ring in `--foreground` plus a 1px `--border` outline offset 2px. Only one at a time.
  Three options only: `--chart-2`, `--chart-3`, `--chart-4`. `--chart-1` is reserved for the
  combined burndown line and `--chart-5` for what-if tinting, so neither is offered.
- **Balance** — number input with a `$` prefix inside the field border. A non-numeric value
  coerces to `0` rather than erroring.
- **As of / Next occurrence** — native date inputs, defaulting to today.
- **Continue** — tap when Name is non-empty → advances to step 2. The handler re-checks the trim
  guard and no-ops if empty, so the gate exists in two places.
- **Progress dots** — the dot for the current step animates from 6px to 18px wide over **150ms**
  (`transition: width 150ms`). Dots for steps already reached are `--primary`; unreached dots are
  `--border`. On the done state both are `--primary` and both are 6px.
- **Bill / Income tabs** — tap → swaps the Name placeholder only. Any name already typed is kept.
- **Cadence select** — Weekly / Biweekly / Monthly. No other cadences in onboarding.
- **Back** — returns to step 1 with the step-1 values intact, and the hero and placeholder come
  back with it. Step-2 values also survive a Back-then-Continue round trip; the two form objects
  are independent.
- **Build my runway** — tap when the item Name is non-empty → done state.
- **See your runway** — navigates to the dashboard. It is an anchor styled as a primary button, so
  build it as `<Button as-child><NuxtLink …>`, not a click handler.
- **Skip to dashboard** — present in the header on every step, including done. Leaves onboarding
  immediately with no data captured.

Not visible in a static export: focus rings on the inputs, hover on the swatches, and the fact
that nothing here is persisted until the flow completes. Nothing is optimistic — there is no
server in the design at all.

---

## Copy

Hero (step 1 only):
- "See how far your money goes."
- "Add one account and one bill or paycheck, and Runway builds your first projection."

Chart placeholder: "Your runway chart appears here"

Header: "Runway" / "Skip to dashboard"

Step 1:
- Eyebrow "STEP 1 OF 2" (rendered uppercase from "Step 1 of 2")
- Title "Add your first account"
- Sub "Runway needs one account balance to start from."
- Labels "Name", "Line color", "Balance", "As of"
- Name placeholder "e.g. Checking"
- Button "Continue"

Step 2:
- Eyebrow "STEP 2 OF 2"
- Title "Add a bill or paycheck"
- Sub "One recurring item is enough to see your first projection."
- Tabs "Bill" / "Income"
- Labels "Name", "Amount", "Cadence", "Next occurrence"
- Name placeholder "e.g. Rent" (Bill) / "e.g. Paycheck" (Income)
- Cadence options "Weekly", "Biweekly", "Monthly"
- Buttons "Back", "Build my runway"

Done:
- Title "You're set."
- Summary, generated: `We'll track {account name} against {item name} ({+|−}{amount}) starting now.`
  Fallbacks when a name is blank: "your account" and "your item". The sign is `+` for income and
  `−` (U+2212 minus, not a hyphen) for a bill. Amount is formatted as absolute dollars with a
  thousands separator and no cents.
- Button "See your runway"
- Footnote "Add more accounts and bills any time from the menu."

The verb chain holds: "Build my runway" → "You're set." → "See your runway".

---

## Token usage

- Page: `--background` on the surface, `--foreground` on text, `--font-sans` throughout.
- Cards: `--card` background, 1px `--border`, `--radius`.
- Muted text (step eyebrow, step sub, field labels, hero sub, placeholder caption, done sub and
  footnote, "Skip to dashboard"): `--muted-foreground`.
- Inputs and the money field: 1px `--input` border on a `--background` fill.
- Primary buttons (Continue, Build my runway, See your runway): `--primary` on
  `--primary-foreground`. "Back" is a transparent outline button using `--border` and
  `--foreground` — i.e. shadcn `variant="outline"`.
- Segmented controls (Bill/Income): `--accent` track, active segment `--card`.
- Chart placeholder: dashed `--border` on an `--accent` fill; the fake line is a repeating dashed
  gradient in `--border`.
- Progress dots: `--primary` when reached, `--border` when not.
- Colour swatches: `--chart-2`, `--chart-3`, `--chart-4`.

Not covered by the repo's token set:

- **`--font-mono`.** The design puts the `$` prefix and every money input in a mono face (Geist
  Mono). The repo has `--font-sans: Figtree` and no mono token at all. Every figure on this screen
  is affected.
- **Chart palette.** The design's `--chart-2` renders green (see the first swatch in the
  screenshots); the repo's `--chart-1`…`--chart-5` are all in the blue family, so the three
  "line colour" options would be three blues and near-indistinguishable. This is the discrepancy
  with the most visible consequence on this screen.

Neither should be hardcoded around — see Open questions.

---

## Accessibility notes

- Focus order: Skip to dashboard → (step 1) Name → three colour swatches → Balance → As of →
  Continue. On step 2: Skip → Bill → Income → Name → Amount → Cadence → Next occurrence → Back →
  Build my runway.
- The colour swatches carry meaning by colour alone. The export gives each an `aria-label`, but
  the label is the raw token id (`chart-2`), which is useless read aloud. Give them human names
  and expose selection with `role="radiogroup"` / `aria-checked`, not just a visual ring. Consider
  RadioGroup rather than bare buttons.
- Swatches are 30px, under the 44px touch target minimum. Either grow them or pad the hit area.
- The progress dots convey step position visually only. Add `aria-label="Step 1 of 2"` on the
  group, or lean on the visible "STEP 1 OF 2" eyebrow as the accessible name and mark the dots
  `aria-hidden`.
- The `$` prefix sits outside the input, so the number field has no unit in its accessible name.
  Attach it via the label or `aria-describedby`.
- Every field label is a plain `div` in the export. They must be real `<Label for>` associations.
- Disabled buttons need the disabled state communicated non-visually too — say why in helper text
  or `aria-describedby`, rather than leaving a dead button.
- The dot width transition should respect `prefers-reduced-motion`.

---

## Open questions

1. **`--font-mono` does not exist in the repo.** The design sets every money figure in Geist Mono.
   Either add a mono token (and the typeface) or accept that amounts render in Figtree. Decide
   once, globally — this affects every screen, not just onboarding.
2. **Chart palette mismatch.** The design's chart ramp is green/green/blue/blue/amber; the repo's
   is five blues. The three line-colour swatches here depend on those three tokens being visually
   distinct, so with the current values the picker stops working as a picker.
3. **"Skip to dashboard" produces a user with no data at all.** The dashboard therefore needs its
   own empty state, and there must be a route back into this flow. That crosses screens and is not
   specified anywhere in this export.
4. **No disabled styling on the primary button** (see Step 1 valid). Needs the standard shadcn
   disabled treatment added.
5. **"Build my runway" is not full width.** The primary button style is written for a full-width
   block (vertical padding only, no horizontal padding). Reused in the step-2 two-button row it
   collapses to content width and the text touches the button edges — visible in
   `screens/step-2.png`. Give the button row proper horizontal padding and decide whether the
   primary should flex to fill.
6. **Header width 640 vs column width 480 on desktop.** Almost certainly a leftover from the other
   screens' 640 column. Confirm both should be 480.
7. **Tabs vs ToggleGroup for Bill/Income.** The export says `Tabs` but styles a segmented control.
   Pick one and use the same component for the equivalent control on recurring-items.
8. **Nothing is persisted mid-flow.** If a user drops out between steps, or hits Skip, is the
   partial account kept? The design never says. Related: does completing onboarding create the
   account and the recurring item as two separate domain records (it should), and what happens if
   the user later deletes the account the item points at?
9. **No validation beyond "name is non-empty."** A zero balance, a zero amount, and a past "next
   occurrence" date all pass. Zero amount in particular produces a done-state summary reading
   "(−$0)". Decide whether amount must be positive.
10. **No account is chosen for the recurring item** because there is only one. The engine should
    attach it to the account created in step 1 implicitly; the recurring-items screen exposes an
    Account select that this flow skips.

**Engine boundary.** The done-state summary string is assembled inline in the export's script
block, and money is formatted there with a local `fmtMoney`. In the implementation, money is held
as integer cents, formatted at the edge, and the summary is composed from already-formatted parts
— the component performs no arithmetic. Likewise the account and the recurring item created here
are domain records; onboarding is only a data-collection wrapper around the same create operations
the accounts and recurring-items screens use, and should reuse them rather than duplicating them.
