# Accounts

**Slug:** `accounts`
**Related issues:** Accounts management
**Last updated:** 2026-08-15

---

## Purpose

The place a user keeps their balances honest. Runway projects from these numbers, so this screen
answers "what does Runway think I have right now, and how do I correct it?" — plus it names the one
account that daily discretionary spending drains.

---

## Component inventory

| Component | Used for |
|---|---|
| Card | The accounts list container, and the disabled "Connect a bank" promo card |
| Button | "+ Add account" (two variants), Delete / Cancel / Save in the editor, editor close ✕ |
| Badge | "Discretionary source" on a list row; "Coming soon" on the bank card |
| **Sheet** | The account editor **on mobile** — bottom sheet with a drag handle |
| **Dialog** | The account editor **on desktop** — centered modal |
| Input | Name (text), Balance (number, `$` prefix), As of (date) |
| Checkbox | "Draw discretionary spend from this account" + help text |
| Separator | Hairline between account rows (drawn as a row border in the export) |

Needs installing (`bunx shadcn-vue@latest add …`): `card`, `badge`, `dialog`, `checkbox`, `label`.
Already installed: `button`, `input`, `sheet`, `separator`.

Custom components to build:

- **`AccountRow`** — Card row: color swatch + name + optional Badge + "Balance as of …" + balance +
  chevron. Composed from a plain element plus Badge; the whole row is the click target.
- **`AccountColorPicker`** — the "Line color" swatch row. Three round buttons, each `aria-label`ed
  with the color name, selected one ringed.
- **`AccountEditor`** — the form body. Rendered inside a Sheet on mobile and a Dialog on desktop;
  identical fields and identical footer in both. This is the one thing on this screen that must not
  be got wrong (see Layout).

---

## Layout

### Mobile

Single centered column, full-width with a **16px side gutter** (`px-4`) — never edge to edge. That
gutter matches the one used at the extreme edges of every other screen.

1. Title block: "Accounts" + subtitle.
2. Accounts Card — one row per account, hairline separated; a **dashed, full-width "+ Add account"
   button as the last item inside the Card**.
3. "Connect a bank" Card — disabled (`aria-disabled="true"`, reduced opacity, `not-allowed` cursor).

### Desktop

Same column, capped at **640px** and centered.

- The title row becomes a two-column flex: title block left, a **solid primary "+ Add account"
  button right**. This button is mobile-hidden.
- The dashed in-Card add button is desktop-hidden. The two are the same action rendered in two
  places; only one is ever visible.
- Rows get slightly more padding; type scales up (page title, subtitle).

### The editor is responsive **by component**, not by CSS

This is the most important behaviour on the screen. Below the desktop breakpoint the editor is a
**Sheet** anchored to the bottom with a drag handle; at desktop it is a **Dialog** centered in the
viewport (fixed ~420px wide) over a scrim. The export literally swaps the `data-component` value
between `Sheet` and `Dialog`. Implement it as one `AccountEditor` form mounted into whichever
wrapper the current breakpoint calls for — do not fake the sheet with a repositioned dialog, and do
not duplicate the form.

Both wrappers sit above a full-viewport scrim; the mobile Sheet caps at 88vh and scrolls internally.

---

## States

### Default — `screens/default.png`
Two seeded accounts: Checking $2,140 (badged "Discretionary source") and Savings $3,200, both
"Balance as of Aug 15, 2026". Below them the disabled bank card.

### Edit (mobile) — `screens/edit-sheet.png`
Tapping a row opens the Sheet pre-filled from that account. Title "Edit account", the account's
color pre-selected, the discretionary checkbox reflecting its current value, and a **Delete** button
present in the footer. Save reads "Save changes".

### Add (mobile) — `screens/add-sheet.png`
Title "Add account". Name empty (placeholder "e.g. Checking"), balance 0, As of defaults to today,
color pre-selected by round-robin over the three options, **no Delete button**, save reads
"Add account". The discretionary checkbox defaults **on only when this is the first account**;
with two accounts seeded it renders off.

### Desktop — `screens/desktop.png`
List with the primary add button in the title row; no dashed button in the Card.

### Edit (desktop) — `screens/edit-dialog.png`
The same form as `edit-sheet`, in a centered Dialog. Compare the two side by side — same fields,
same footer, different container.

### Dark — `screens/dark.png`
Captured by setting the dark class directly on the document (the export's own theme toggle flips its
icon but never applies the class when rendered offline). No layout change.

There is **no empty state in the export** — it always seeds two accounts. One is needed: deleting
the last account, or arriving via first-run's "Skip to dashboard", both reach zero accounts. Copy
for it is undecided (see Open questions).

---

## Interactions

- **Account row** — tap/click anywhere on the row → opens the editor pre-filled for that account.
  The whole row is the target, not just the chevron; the chevron is decorative affordance only.
- **"+ Add account"** (either placement) → opens the editor in add mode with a blank form.
- **Line color swatch** — click → selects that color; selection shown as a ring around the swatch.
  Only three choices are offered: `--chart-2`, `--chart-3`, `--chart-4`. `--chart-1` is reserved for
  the combined burndown line and `--chart-5` for what-if/warning tinting elsewhere in the app.
- **Discretionary checkbox** — toggles the flag on the form only; the exclusivity rule applies on
  save, not on toggle.
- **Save** — validates that the trimmed name is non-empty; if empty it is a **silent no-op** in the
  export. Real implementation should disable the button (or show a field error) instead of doing
  nothing. On success the editor closes.
- **Delete** — removes the account and closes the editor immediately, with **no confirmation** in the
  export. Deleting an account that recurring items or transfers reference is unhandled; needs a
  decision (see Open questions).
- **Cancel / ✕ / scrim click** — all close the editor and discard the form.
- **"Connect a bank" card** — inert. Not focusable, not clickable.

### Business rules that belong in the domain engine, not the component

- **Only one discretionary source.** The save handler clears `isSource` on every other account
  before writing the edited one. Enforce this as an invariant in the engine so the flag cannot be
  held by two accounts regardless of which surface writes it.
- **Balance is a point-in-time reading.** A row is "balance + as-of date", and projection runs
  forward from that date. The component must not do any arithmetic on it; money is held as integer
  cents and formatted only at the edge.
- The export's dates are strings and its balances plain numbers — that is prototype shorthand, not
  the data model.

---

## Copy

| Where | Exact string |
|---|---|
| Page title | Accounts |
| Page subtitle | These balances feed your runway. Keep them current. |
| Add button (both) | + Add account |
| Row meta | Balance as of `<Mon D, YYYY>` |
| Row badge | Discretionary source |
| Bank card title | Connect a bank |
| Bank card sub | Sync balances automatically instead of updating them by hand. |
| Bank card badge | Coming soon |
| Editor title (editing) | Edit account |
| Editor title (adding) | Add account |
| Field labels | Name / Line color / Balance / As of |
| Name placeholder | e.g. Checking |
| Checkbox label | Draw discretionary spend from this account |
| Checkbox help | The account your daily spending figure drains. Only one account can hold this. |
| Footer buttons | Delete / Cancel |
| Save (editing) | Save changes |
| Save (adding) | Add account |

Balances format as `$2,140` — no cents shown, negatives as `-$1,234`.

---

## Token usage

- Surfaces: `--card` for both Cards and for the Sheet/Dialog panel; page on `--background`;
  hairlines and the dashed add button border on `--border`.
- Text: `--foreground` for names and titles; `--muted-foreground` for the subtitle, "Balance as of",
  field labels, the `$` prefix, and the checkbox help.
- Primary: `--primary` / `--primary-foreground` for the desktop add button, the save button, the
  dashed add button's label, and the checked Checkbox fill.
- `--accent` for the bank card's icon tile and its "Coming soon" Badge background.
- `--destructive` for the Delete button's label.
- `--input` for form field borders; `--radius` for card corners.
- Account line colors: `--chart-2`, `--chart-3`, `--chart-4` only. Seeded Checking = `--chart-3`,
  Savings = `--chart-4`.
- Balances, the `$` prefix, and the number input use a **monospace** family.

Not covered by the repo's token set — see Open questions.

---

## Accessibility notes

- Rows are `div`s with a click handler in the export. They must be real buttons (or
  `role="button"` + `tabindex="0"` + Enter/Space) so keyboard users can open the editor.
- Color swatches carry no text; each needs its `aria-label` (the export supplies one) and the
  selected state needs `aria-pressed` / `aria-checked` — the ring alone is not enough.
- The color swatch is currently the **only** visual distinguishing accounts in the burndown chart.
  Color is doing semantic work; the chart needs a non-visual equivalent (name in the tooltip/legend
  and in any data table), and the swatch here should be paired with the account name everywhere.
- Editor: focus must move into the panel on open and return to the trigger on close; Escape closes;
  focus is trapped while open. `aria-modal` + a labelled title on both the Sheet and the Dialog.
- The ✕ close button is 28×28 — below the 44px touch minimum on mobile. Enlarge the hit area.
- Delete is destructive and unconfirmed; at minimum it needs a confirm step and an undo affordance.
- The "Connect a bank" card is `aria-disabled` — keep it out of the tab order entirely.
- The Badge "Discretionary source" repeats information the checkbox owns; make sure it isn't the
  only way that state is announced.

---

## Open questions

1. **Chart palette mismatch.** The design's `--chart-1`/`--chart-2` are greens and `--chart-3`/
   `--chart-4` blues; the repo's `--chart-1`…`--chart-5` are all in the blue family. The three
   account color choices therefore render as green/blue/blue in the export but would be three
   near-identical blues in the app — which defeats the purpose of picking a line color. Needs
   resolving before this screen ships.
2. **No monospace token.** Every figure here (balances, the `$` prefix, the number input) uses a
   mono family in the design. The repo has `--font-sans: Figtree` and no mono token at all.
3. **Typeface.** The design loads Geist / Geist Mono; the repo uses Figtree.
4. **Empty state.** Unreachable in the export (two accounts are always seeded) but reachable in the
   app by deleting the last account or skipping first-run. Copy and the invited action are
   undefined. Related: with zero accounts there is no discretionary source, so the dashboard's
   spending figure has nothing to drain.
5. **Delete cascade.** What happens to recurring items and transfers pointing at a deleted account
   is unspecified. Also unspecified: what happens to the discretionary flag when the account holding
   it is deleted.
6. **Add button duplication.** Two buttons for one action, split by breakpoint. Confirm this is
   intended rather than collapsing to a single responsive button.
7. **Dark-mode add button.** In dark the dashed "+ Add account" label reads near-white rather than
   the blue it uses in light, because the design's `--primary` inverts. Confirm that is intended;
   it currently reads as a secondary action in dark and a primary one in light.

---

## Notes on capture

- Mobile shots are 500px wide, not the brief's 470: Chromium enforces a 500px minimum viewport, so
  `--width 470` silently renders at 500 and crops the right 30px — which clipped the full-bleed
  Sheet. The design's mobile column is still 430 and centers within it.
- The screenshot driver's `--do` string is injected into JS as a quoted array, so **any action
  containing a double quote breaks the whole driver silently** and no actions run. Use unquoted CSS
  attribute selectors (`[data-component=Card]`, not `[data-component="Card"]`). This is what
  produced the earlier byte-identical screenshots.
- Account rows have their `onClick` attribute stripped during hydration, so the driver's
  text-matching actions cannot reach them; the editor is opened with
  `nth:[data-component=Card] > div:0`.
- **Export bug:** `openAdd` is never returned from `renderVals()`, so both "+ Add account" buttons
  are dead in `reference.html`. `add-sheet.png` was captured from a temporary patched copy that
  exposes the handler; `reference.html` itself is unmodified.
