# Transfers

**Slug:** `transfers`
**Related issues:** Transfers
**Last updated:** 2026-08-15

---

## Purpose

Move money between your own accounts. This never counts as income or spending — a transfer only
relocates a balance, so the runway projection must be unchanged by it. The screen answers "shift
money from one account to another, and show me what I've already shifted."

---

## Component inventory

Canonical `shadcn-vue` names. The design marks its intent with `data-component` attributes; this
table follows them.

| Component | Used for | Status |
|---|---|---|
| Card | "New transfer" form card; "Recent transfers" list card | new — `bunx shadcn-vue@latest add card` |
| Select | From account, To account | new — `add select` |
| Input | Amount (number, `$` prefix) and Date (date) | installed |
| Button | "Move money" primary submit, full-width | installed |
| Alert | Same-account warning inside the form card | new — `add alert` |
| Badge | "Transfer" tag on every recent-transfer row | new — `add badge` |
| Label | The `From` / `To` / `Amount` / `Date` field labels (plain text in the export; use Label for the `for`/`id` pairing) | new — `add label` |
| Separator | Row dividers in the transfers list (the export uses a `border-bottom` per row) | installed |

Custom, not shadcn primitives:

- **AccountSwatch** — an 11px round dot filled with the account's line color. Composed from a
  `<span>`; shared with Accounts and Recurring items.
- **TransferLegs** — from-swatch → arrow glyph → to-swatch, used in each list row. Composed of two
  AccountSwatch plus a muted `→`.
- **MoneyInput** — Input with a `$` prefix inside the bordered box; the prefix and the value are
  both monospace. Shared with Accounts / Recurring items.

Not part of the app: the export's header carries a `← Dashboard` link, a Mobile/Desktop viewport
Tabs control and a theme toggle. Those are prototype chrome, not this screen's UI.

---

## Layout

The content is a single centered column, capped on desktop at 640px. On small screens it goes
full-width but keeps a 16px side gutter — never edge to edge. That 16px matches the gutter used at
the extreme edges elsewhere, so it stays consistent across screens (Tailwind `px-4`).

### Mobile

```
Transfers                       (page title)
Move money between your own accounts. …   (subtitle, muted)

┌─ Card ─────────────────────────────────┐
│ New transfer                           │
│ From                 →   To            │   two Selects on one row,
│ [ Checking     v]        [ Savings  v] │   arrow between, bottom-aligned
│ Amount                   Date          │
│ [ $ 0         ]          [08/15/2026]  │
│ ( Alert — only when From == To )       │
│ [        Move money        ]           │   full-width
└────────────────────────────────────────┘

Recent transfers                (muted section heading, outside the card)

┌─ Card ─────────────────────────────────┐
│ ●→●  Checking to Savings   $400        │
│      Aug 1               [Transfer]    │
│ ─────────────────────────────────────  │
│ ●→●  Savings to Checking   $150        │
│      Jul 18              [Transfer]    │
└────────────────────────────────────────┘
```

Vertical rhythm between the title block, form card, section heading and list card is a single
consistent gap (16px).

### Desktop

Nothing changes structurally. The column caps at 640px and centers, card padding grows slightly,
the page title and the "Recent transfers" heading step up one size, and list rows get taller.
Both selects stay on one row at every width.

---

## States

### Default — `screens/default.png`

From = Checking, To = Savings, Amount = 0, Date = today. Two seeded transfers in the list.
Because the amount is 0, **"Move money" is disabled in the default state** — muted fill, muted
label. Worth calling out: the screen's resting state is a disabled submit.

### Amount entered — `screens/amount-entered.png`

Amount > 0 and the two accounts differ, so "Move money" takes the primary fill with
primary-foreground text and a pointer cursor. This is the only difference from default.

### Same-account warning — `screens/same-account-warning.png`

From and To both resolve to the same account. An Alert appears between the fields and the button:
"Choose two different accounts to move money between them." Submit stays disabled. Note this state
is only reachable by changing **To** — changing **From** to the current To auto-corrects To (see
Interactions), so the design makes the warning hard to trigger from the left-hand control.

### Desktop — `screens/desktop.png`

Default data at the 640px cap.

### Dark — `screens/dark.png`

Same content on the dark palette. Captured by setting the dark class on the document directly (the
export's own theme button flips its icon but does not apply the class when rendered offline). The
only artifact: the dark page fill stops at the end of the flex column, leaving a light band below
the content in the capture — a prototype-export artifact, not a design decision.

### Empty — not reachable, no screenshot

The export seeds two transfers and offers no delete, so the empty state cannot be rendered. The
copy exists in the design and must be implemented: "No transfers yet. Moves you make between your
accounts will show up here." It renders as muted text inside the list Card (the Card itself stays).

### Loading / Error

The design specifies neither. See Open questions.

---

## Interactions

- **From select** — change → sets From. If the chosen account equals the current To, To is
  auto-switched to a different account. So changing From never lands you in the warning state.
- **To select** — change → sets To only. No auto-correction, so To == From is allowed and produces
  the Alert.
- **Amount** — number input, change → parsed to a number; a non-numeric parse falls back to 0.
- **Date** — date input, defaults to today; an empty value is ignored (the previous date is kept),
  so the field can never become blank.
- **Move money** — enabled only when From != To **and** amount > 0. Disabled state changes both
  fill (accent instead of primary) and cursor (`not-allowed`) — the disabled look is specified, not
  inherited. On click: prepend the new transfer to the list, reset Amount to 0, and leave From, To
  and Date as they were, ready for another move.
- **Recent transfer rows** — static in the design. No tap target, no edit, no delete, no chevron
  (unlike Accounts and Recurring items rows, which do have one).
- The list is sorted by date descending. A newly added transfer is prepended, which means a
  back-dated transfer appears at the top until the sort is re-applied — implement as a real sort on
  date, not a prepend.

---

## Copy

| Slot | String |
|---|---|
| Page title | Transfers |
| Subtitle | Move money between your own accounts. This never counts as income or spending. |
| Form card title | New transfer |
| Field labels | From · To · Amount · Date |
| Amount prefix | $ |
| Warning Alert | Choose two different accounts to move money between them. |
| Submit | Move money |
| List heading | Recent transfers |
| Row primary | `<From> to <To>` — e.g. "Checking to Savings" |
| Row secondary | Short date — e.g. "Aug 1", "Jul 18" |
| Row badge | Transfer |
| Empty | No transfers yet. Moves you make between your accounts will show up here. |

Amounts render unsigned (`$400`), with no `+`/`−` and no color — deliberately, since a transfer is
neither a gain nor a loss. Keep it that way.

---

## Token usage

- Page: `--background` / `--foreground`; cards `--card` with a `--border` hairline and `--radius`.
- Muted text (subtitle, field labels, row date, list heading, empty copy, arrow glyphs):
  `--muted-foreground`.
- Selects and inputs: `--input` border on a `--background` fill.
- Submit enabled: `--primary` with `--primary-foreground`. Submit disabled: `--accent` fill with
  `--muted-foreground` text.
- Warning Alert: `--destructive` text on an `--accent` fill (no destructive-tinted background, no
  border).
- "Transfer" Badge: `--accent` fill, `--muted-foreground` text, fully rounded.
- Account swatches: the per-account line color — Checking `--chart-3`, Savings `--chart-4`
  (`--chart-1` is reserved for the combined burndown line, `--chart-5` for what-if tinting).
- Typography: labels and body in `--font-sans`; **every money figure, the `$` prefix and the amount
  input use `--font-mono`.**

Not covered by the repo token set — see Open questions: there is no mono token, and `--chart-3` /
`--chart-4` are not the design's colors.

---

## Accessibility notes

- Focus order: back link → From → To → Amount → Date → Move money → (list is not focusable).
- The `→` between the two selects and the `→` inside each row's swatch pair are decorative; hide
  them from assistive tech (`aria-hidden`). The row's own text already says "Checking to Savings".
- Account swatches carry color-only meaning. They are decorative here because the account name is
  always adjacent — mark them `aria-hidden` rather than trying to name a color.
- The same-account Alert must be a live region (`role="alert"`) so the reason for the disabled
  button is announced when it appears.
- Do not rely on the disabled button alone to explain "amount is 0" — that condition has no visible
  message at all (see Open questions).
- Field labels are plain divs in the export; wire real `<label for>` associations.
- Touch targets: the selects and inputs are ~40px tall, at the low end. The submit button is
  comfortably tall and full-width.

---

## Business rules for the domain engine

- **A transfer is balance-neutral.** It decrements the From account and increments the To account
  by the same amount on the same date. It must never appear as income or spending in the burndown,
  and it must not move the projected end balance.
- **The two legs are one logical record.** Store a single transfer with `fromAccountId`,
  `toAccountId`, amount and date — never two independent ledger entries that could drift apart or
  be edited separately.
- From and To must differ; amount must be > 0. The export enforces both in its click handler as
  well as via the disabled button — validate in the engine, not only in the component.
- Amounts are integer cents in the domain and are formatted only at the edge. The export's
  `fmtMoney` rounds to whole dollars for display; that rounding is a display concern.
- Components perform no financial arithmetic.

---

## Open questions

1. **Chart palette mismatch.** The design's `--chart-3` / `--chart-4` are blues while `--chart-1` /
   `--chart-2` are greens; the repo's `--chart-1`…`--chart-5` are all in the blue family. The two
   seeded account swatches are already hard to tell apart in the export, and the repo palette will
   make them harder. Needs resolving alongside Accounts, which owns swatch selection.
2. **No mono token.** Every money figure, the `$` prefix and the amount input are `--font-mono` in
   the design. The repo's `--font-sans` is Figtree and there is no mono token at all, so these
   currently have nothing to map to.
3. **No message for the amount-is-0 case.** From == To gets an explanatory Alert; amount ≤ 0 just
   silently disables the button. Decide whether that needs its own helper text.
4. **Recent transfers are read-only.** No edit, no delete, no undo, and no row affordance — unlike
   the Accounts and Recurring items rows. Is a mistaken transfer meant to be uncorrectable?
5. **No loading or error state is specified**, and the form has no pending/submitted treatment.
6. **List length is unbounded** — no pagination, "show more", or window on "Recent". Needs a cap.
7. **Two accounts only.** With exactly two seeded accounts, From's auto-correction has a single
   obvious target. With three or more, which account it switches To to is undefined — the export
   picks the first that differs.
8. **Same-day ordering.** Rows sort by date alone, so two transfers on the same date have no
   defined order. Needs a stable secondary sort (created-at).
