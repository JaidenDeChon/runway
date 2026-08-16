# Recurring items

**Slug:** `recurring-items`
**Related issues:** Recurring items, Income prediction
**Last updated:** 2026-08-15

---

## Purpose

One place to see every bill and paycheck that moves your balance, ordered by what hits next, so you
can add, correct, or remove the things that shape your runway. Income you don't control exactly
(a variable paycheck) can be estimated for you instead of typed in.

---

## Component inventory

The export marks intent with `data-component`; this table uses the canonical `shadcn-vue` names.

| Component | Used for | Status |
|---|---|---|
| Card | The list container; also the surface style of the editor | **add** |
| Button | Add (desktop solid / mobile dashed), Save, Cancel, Delete, close ✕, theme toggle | installed |
| Badge | Row markers: "Predicted", "Est." | **add** |
| ToggleGroup | All / Bills / Income filter; income "Amount source" (Fixed amount / Predict from deposits) | **add** |
| Tabs | Bill / Income type switch inside the editor | **add** |
| Input | Name (text), Amount (number, `$` prefixed), Next occurrence (date) | installed |
| Select | Cadence (Weekly / Biweekly / Monthly), Account | **add** |
| Checkbox | "Amount varies each cycle" (bill only) | **add** |
| Sheet | The editor **on mobile** — bottom sheet with a drag handle | installed |
| Dialog | The editor **on desktop** — centered modal, fixed width | **add** |
| Label | Field labels above every control | **add** |
| Separator | Row dividers inside the list Card (export draws them as a per-row bottom border) | installed |

Custom composition:

- **RecurringItemRow** — account color swatch + name + meta line + amount + optional Badge +
  chevron. Not a shadcn primitive; composed from Badge and layout only. It is the only tappable
  region of a row and it opens the editor.
- **PredictedAmountPanel** — the info box that replaces the amount Input for predicted income.
  Composed from Card/`--accent` surface + the predicted figure + help text. Note it also **contains
  the "Next occurrence" date Input**, so that field moves inside the panel in this mode.

---

## Layout

Single centered column. Capped at 640px on desktop. On small screens it goes full-width but keeps a
16px side gutter — never edge to edge. That 16px matches the gutter used at the extreme edges
elsewhere, so it stays consistent across screens (Tailwind `px-4`).

### Mobile

```
← Dashboard                       [Mobile|Desktop]  [☾]
Recurring
Bills and income that shape your runway.
[ All | Bills | Income ]                        <- ToggleGroup, fit-content
┌──────────────────────────────────────────────┐
│ ● Car payment                    −$310    ›  │
│   Monthly · Checking · next Aug 20           │
│ ──────────────────────────────────────────── │
│ ● Paycheck                     +$2,450    ›  │
│   Biweekly · Checking · next Aug 21 [Predicted]│
│ … one row per item, sorted by next date …    │
│ ┌────── + Add recurring item ──────────────┐ │  <- dashed, mobile only
└──────────────────────────────────────────────┘
```

The editor opens as a **Sheet** anchored to the bottom, over a scrim, max height 88vh, scrolls
internally.

### Desktop

- Column max-width 640px; larger title and denser row padding.
- The Add button moves: solid primary button in the title row (desktop only); the dashed full-width
  button at the foot of the list Card is hidden.
- The editor becomes a **Dialog** — centered, 440px wide, max height 88vh. This mobile-Sheet /
  desktop-Dialog swap is the most important structural detail on this screen; both must be built.

---

## States

### Default — `screens/default.png`
All eight seeded items, filter on "All", sorted by next occurrence ascending — bills and income
interleaved, not grouped by type. Income amounts are prefixed `+` and coloured positive; bills are
prefixed with a true minus sign `−` in the foreground colour.

### Filter: Bills — `screens/filter-bills.png`
Six bills. "Electric & water" carries the "Est." Badge.

### Filter: Income — `screens/filter-income.png`
Two income items. "Paycheck" carries the "Predicted" Badge.

### Edit predicted income — `screens/edit-predicted-income.png`
Sheet opened on "Paycheck". Type tab = Income, Amount source = "Predict from deposits", so the
amount Input is replaced by the predicted panel showing `+$2,450 predicted`. Delete is present
because this is an edit; Save reads "Save changes".

### Edit variable bill — `screens/edit-variable-bill.png`
Sheet opened on "Electric & water". Type tab = Bill, amount Input and date side by side, the
"Amount varies each cycle" Checkbox is ticked. The "Amount source" ToggleGroup is absent — it is
income-only.

### Edit on desktop (Dialog) — `screens/edit-dialog.png`
Same form, centered Dialog, no drag handle, list still visible behind the scrim.

### Desktop — `screens/desktop.png`
List at 640px with the solid title-row Add button.

### Dark — `screens/dark.png`
Captured by setting `.dark` on the document directly (the export's own theme button flips its icon
but never applies the class offline). Everything holds up; see Open questions for the one nit.

### Empty — `screens/empty.png`
Reachable, but only by deleting every item one at a time — the export seeds eight and has no reset.
Shows the copy line plus the dashed add button inside an otherwise empty Card. This is the true
first-run-ish state for the screen and needs building.

### Add (new item) — **not captured**
The blank-form variant of the editor (title "Add recurring item", no Delete, Save reads "Add item")
is unreachable in the export: `openAdd` is defined on the component but never returned from
`renderVals()`, so both "+ Add recurring item" buttons have no handler. The form is otherwise
identical to edit, seeded with type `bill`, cadence `monthly`, first account, amount 0, next
occurrence = today. See Open questions.

### Loading / Error
The export models neither. Both need designing; at minimum a Skeleton list of ~4 rows to match the
list Card, since the item list is the whole page.

---

## Interactions

- **Filter ToggleGroup** — tap All / Bills / Income → filters in place, no reload → the list Card
  re-renders. Sort order is preserved within a filter. Filter state is view-local, not persisted.
- **Item row** — tap anywhere on the row → opens the editor pre-filled from that item → Sheet on
  mobile, Dialog on desktop. The chevron is decoration, not a separate target.
- **Scrim** — tap outside the editor → closes it, discarding edits. No confirmation. The ✕ and
  "Cancel" do the same thing.
- **Bill / Income Tabs** — switching type changes the Name placeholder ("e.g. Electric & water" vs
  "e.g. Paycheck"), shows the income-only "Amount source" ToggleGroup, and hides the bill-only
  "Amount varies each cycle" Checkbox. Values already typed are kept.
- **Amount source: Predict from deposits** — replaces the Amount Input with the predicted panel.
  The date field relocates into that panel.
- **Amount varies each cycle** — ticking it makes the row render an "Est." Badge. The typed amount
  is still stored and still used for projection; the flag only marks it as provisional.
- **Save** — writes the item and closes. Editing updates in place; adding appends. Sort position
  recomputes immediately from the new next-occurrence date.
- **Delete** — visible only when editing. Removes the item and closes immediately, with **no
  confirmation and no undo**. Needs a decision before build.
- **Empty name** — Save is not disabled; it simply does nothing. Needs real validation (see Open
  questions).

### Income prediction — the subtle part

- The predicted value is the **arithmetic mean of the stored deposit history** for that item
  (`Paycheck` is seeded with three deposits and predicts 2,450).
- It is written into the item's amount **at save time**, not recomputed at render time; the row and
  the projection then read a single stored figure.
- It applies only when type is Income **and** source is "Predict from deposits". Switching back to
  "Fixed amount" abandons it and uses the typed value.
- The copy promises it is superseded by reality: "Runway uses this estimate until a real deposit
  lands." So landing a deposit must both append to history and re-derive the amount — the export has
  no code for that half; it must exist in the domain engine.
- **The averaging, the cadence expansion, and next-occurrence math all belong in the domain engine,
  not in the component.** The export does this inline in its script block; components render already
  computed values and format money from integer cents at the edge.

---

## Copy

- Title: **Recurring**
- Subtitle: **Bills and income that shape your runway.**
- Filter: **All** / **Bills** / **Income**
- Add button (both placements): **+ Add recurring item**
- Row meta: `<Cadence> · <Account> · next <Mon D>` — e.g. `Biweekly · Checking · next Aug 21`
- Row badges: **Predicted** (predicted income), **Est.** (variable bill)
- Empty: **No recurring bills or income yet. Add your first one below.**
- Editor title: **Edit recurring item** / **Add recurring item**
- Type tabs: **Bill** / **Income**
- Field labels: **Name**, **Cadence**, **Account**, **Amount**, **Next occurrence**, **Amount source**
- Name placeholders: **e.g. Electric & water** (bill) / **e.g. Paycheck** (income)
- Cadence options: **Weekly**, **Biweekly**, **Monthly**
- Amount source: **Fixed amount** / **Predict from deposits**
- Predicted figure: **+$2,450 predicted**
- Predicted help: **Predicted from your last 3 deposits. Runway uses this estimate until a real
  deposit lands.** (the count is the number of stored deposits)
- Variable checkbox: **Amount varies each cycle**
- Variable help: **Shows as an estimate, like a utility bill. Update it as real amounts come in.**
- Buttons: **Delete**, **Cancel**, **Save changes** (editing) / **Add item** (adding)

Verb consistency note: the trigger says "Add recurring item" and the submit says "Add item". Pick
one — "Add recurring item" throughout, with the toast "Recurring item added."

---

## Token usage

- Page surface `--background`, text `--foreground`, secondary text `--muted-foreground`.
- List Card and editor surface `--card`, hairlines and row dividers `--border`, corner radius from
  `--radius`.
- Filter ToggleGroup, type Tabs, source ToggleGroup and the predicted panel all sit on `--accent`;
  the selected segment lifts to `--card`.
- Row Badge: `--accent` fill, `--muted-foreground` text.
- Primary actions (desktop Add, Save, checked Checkbox fill) `--primary` on
  `--primary-foreground`; the mobile dashed Add uses `--primary` text on a transparent fill with a
  `--border` dashed edge. Inputs and Selects use `--input` for their border.
- Delete uses `--destructive` as text on a transparent fill.
- Account swatches use `--chart-3` and `--chart-4`. `--chart-1` is reserved for the combined
  burndown line and `--chart-5` for what-if tinting, so only `--chart-2`/`-3`/`-4` are assignable
  to accounts.
- Income amounts and the predicted figure use a positive/gain colour that **this repo has no token
  for** (see Open questions).
- All money — row amounts, the `$` prefix, the amount Input, the predicted figure — is monospace.
  There is no mono token in this repo (see Open questions).

---

## Accessibility notes

- **Rows must be real controls.** The export makes each row a `div` with a click handler. Build as
  `<button>` (or `role="button"` with keyboard handling) so rows are tabbable and announce as
  "Edit <name>".
- **Colour is the only account indicator.** The swatch has no text equivalent, but the meta line
  already names the account — keep it, and mark the swatch `aria-hidden`.
- **Sign is carried by colour and a glyph.** `−` and `+` are typographic characters, not minus/plus
  words; give each amount an accessible label like "Paycheck, income, $2,450" so screen readers do
  not read `−` as a hyphen or drop it.
- **Badges are abbreviations.** "Est." needs an expansion ("Estimated amount"); "Predicted" should
  reference the source ("Predicted from deposit history").
- **The Checkbox is a styled `span` in the export** with no input element. Use the real shadcn
  Checkbox so it is focusable and toggles on Space, and wire the help text via `aria-describedby`.
- **Field labels are plain text.** Associate every one with its control (`Label for=`), especially
  the two Selects, which sit side by side and are otherwise ambiguous.
- **Focus management for the editor:** focus moves to the editor on open, is trapped while open,
  Escape closes, and focus returns to the row that opened it. The ✕ needs an accessible name
  ("Close").
- **Touch targets:** the ✕ is 28px and the mobile drag handle is decorative. Bring the close control
  to at least 44px, or rely on the scrim and Cancel on mobile.
- Focus order: back link → viewport/theme controls → title Add (desktop) → filter group (single tab
  stop, arrow keys within) → each row → mobile Add.

---

## Open questions

1. **No positive-money token.** Income amounts and the predicted figure use the design's
   `--chart-positive`. This repo has no such token — and no green at all. `--destructive` covers the
   negative side; the positive side has no equivalent. Needs a token added before build.
2. **Chart palette mismatch.** The design's `--chart-1`/`-2` are greens and `-3`/`-4` blues; the
   repo's `--chart-1`…`--chart-5` are all blue. Account swatches therefore render as two nearly
   identical blues (visible in `default.png`), which defeats the point of a per-account colour.
3. **No mono token.** Every figure on this screen is monospace in the design (Geist Mono). The
   repo's `--font-sans` is Figtree and there is no `--font-mono`. Nothing to map to today.
4. **The Add path is not implemented in the export.** `openAdd` exists but is never exposed, so
   neither Add button does anything and the add-mode editor cannot be rendered. Confirm the intended
   blank-form defaults (bill / monthly / first account / amount 0 / today) rather than inferring
   them from dead code.
5. **Predicted-amount fallback is wrong for new items.** With no deposit history the panel shows
   `+$0 predicted` yet the copy still says "your last 3 deposits" — the count falls back to a
   hardcoded 3. Decide what "Predict from deposits" should do before any history exists: disable the
   option, or show a "not enough history yet" state.
6. **Deposit history has no UI.** The prediction reads a history array that nothing on this screen
   can view or edit, and "until a real deposit lands" implies an ingestion path that does not exist
   yet. Where does history come from, and how many deposits form the mean?
7. **Prediction is stored, not live.** Saving freezes the mean into the amount. If history changes
   later, does the item re-predict automatically, or only when reopened and saved?
8. **No validation feedback.** Save with an empty name silently does nothing. Should Save be
   disabled (as First Run does), or should the field show an error?
9. **Delete is immediate and irreversible** — no confirm, no undo toast. Needs a decision.
10. **Variable bills have no history capture.** "Update it as real amounts come in" describes a
    workflow the screen doesn't offer; only the flag and a single amount are stored.
11. **Cadence has no end date, no skip, and no "last occurrence".** A finite series (a 12-month
    loan) can't be expressed, which will overstate long-range projections.
12. **Dark mode nit:** the dashed mobile Add button draws its label from `--primary`, which in dark
    reads as near-white rather than an accented action, making it look like static text rather than
    the primary way to add on mobile. Worth an explicit accent in dark.
13. Screenshots were captured at a 500px-wide viewport rather than 470 — headless Chromium clamps
    its layout viewport to a 500px minimum, so a 470px capture silently crops 30px off the right and
    cut the bottom-anchored Sheet. Noting it so later re-shoots of any screen use 500.
