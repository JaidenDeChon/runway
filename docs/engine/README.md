# The projection engine

`domain/` turns accounts, recurring rules, transfers and a couple of settings
into a daily balance series, a lowest projected point, and a shortfall figure.
Every screen in Runway is a view onto that one function.

It is a pure module. No Nuxt, no Supabase, no network, no filesystem, and no
clock: given the same input it returns the same output, forever. That is not
tidiness for its own sake — it is what makes the engine exhaustively testable
without infrastructure, and it is enforced rather than promised
(`tests/domain/purity.test.ts` reads the source and checks).

- **Money is integer minor units.** There is not one floating-point monetary
  value anywhere in `domain/`. Major units exist at the display edge only.
- **Dates are calendar days**, `YYYY-MM-DD`, never instants. A bill due on the
  20th is due on the 20th in every timezone on earth.
- **`today` is a parameter.** The engine never asks what time it is.
- **Balances may go negative.** The engine reports them; clamping at zero would
  hide the only thing the user needs to know.
- **Nothing is logged.** A balance must never reach an application log.

## The public API

| Function | Answers |
|---|---|
| `project(data, window)` | the whole picture: per-account and combined series, each with its low point and closing balance, plus the occurrences that moved them |
| `evaluate(summary, cushion)` | covered / tight / short, the margin, and the shortfall |
| `shortfallThrough(data, question)` | "will I make it to this date?" and, if not, by how much |
| `occurrencesIn(data, window)` | the individual events in a window, expanded from the rules |
| `upcomingBills(data, today)` | the next occurrence of each bill ahead, for the shortfall screen's picker |
| `signedAmount(item)` | the signed delta of a rule, so a screen never re-derives the sign from `kind` |
| `classifyMargin(margin)` | the three-band verdict on its own |
| `todayIn(zone, instant)` | which calendar day it is, in a zone (`domain/dates.ts`) |
| `dailyDiscretionary(monthly, date)` | what discretionary spending costs on a day (`domain/discretionary.ts`) |

Everything returns plain serializable data — no class instances, no live
references — so a result can be memoized, cached, or moved to a worker later
without changing a caller.

## Worked example: a dashboard

```ts
import { evaluate, project } from '~~/domain/projection'

const data: RunwayData = {
  accounts: [
    { id: 'checking', name: 'Checking', balance: 214_000, balanceAsOf: '2026-08-15',
      color: 'chart-2', isDiscretionarySource: true },
    { id: 'savings', name: 'Savings', balance: 320_000, balanceAsOf: '2026-08-15',
      color: 'chart-4', isDiscretionarySource: false },
  ],
  recurringItems: [
    { id: 'rent', name: 'Rent', kind: 'bill', amount: 180_000, cadence: 'monthly',
      accountId: 'checking', nextOccurrence: '2026-09-01',
      amountSource: 'fixed', depositHistory: [], isVariable: false },
    { id: 'pay', name: 'Paycheck', kind: 'income', amount: 310_000, cadence: 'biweekly',
      accountId: 'checking', nextOccurrence: '2026-08-21',
      amountSource: 'fixed', depositHistory: [], isVariable: false },
  ],
  transfers: [],
  monthlyDiscretionarySpend: 103_400,   // $1,034 a month
  safetyCushion: 60_000,                // $600
}

const projection = project(data, {
  start: '2026-08-15',
  end: '2026-09-13',
  verdictFrom: '2026-08-16',   // judge what is coming, not what already happened
})

projection.days.length              // 30
projection.combined[0].balance      // 534_000  — $5,340 across both accounts today
projection.combinedSummary.ending   // 875_829  — $8,758.29 on the last day
projection.combinedSummary.lowest   // { date: '2026-08-20', balance: 517_325 }

projection.occurrences.map((o) => `${o.date} ${o.label} ${o.amount}`)
// [ '2026-08-21 Paycheck 310000', '2026-09-01 Rent -180000', '2026-09-04 Paycheck 310000' ]

evaluate(projection.combinedSummary, data.safetyCushion)
// { status: 'covered', margin: 457_325, isCovered: true, shortfall: 0,
//   lowest: { date: '2026-08-20', balance: 517_325 } }
```

The low point is the 20th, not the day rent lands — the paycheck on the 21st
outruns the rent on the 1st, and the deepest the combined line gets is the day
before that paycheck arrives. That is the whole reason the engine walks days
rather than summing events.

Narrowing to one account narrows the combined line to that account:

```ts
project(data, { start: '2026-08-15', end: '2026-09-13',
                accountIds: ['checking'], verdictFrom: '2026-08-16' })
  .combinedSummary.lowest   // { date: '2026-08-20', balance: 197_325 }
```

## Worked example: will I make it?

A different, tighter portfolio: **$2,000 in checking today, rent of $1,800 on the
18th, and a $2,500 paycheck on the 25th.** (This is the scenario committed in
`domain/projection.test.ts`, so the figures below are the tested ones.)

```ts
import { shortfallThrough } from '~~/domain/projection'

const answer = shortfallThrough(tight, {
  today: '2026-08-15',
  through: '2026-08-30',
  cushion: 60_000,
})

answer.endingBalance   // 270_000 — $2,700 on the 30th, comfortably clear
answer.isCovered       // false
answer.lowest          // { date: '2026-08-18', balance: 20_000 }
answer.shortfall       // 40_000 — $400 short, on the 18th
```

**The shortfall is measured against the running minimum, not the closing
balance.** Those are different numbers whenever a bill lands before the paycheck
that covers it — which is the situation the screen exists for. A window can
close $2,700 up and still bounce a payment in the middle of it; reading the
endpoint would answer "yes, you make it" to someone who does not.

Spending exactly `answer.shortfall` puts the low point precisely *on* the
cushion. There is a test that checks that, because a shortfall figure that is
approximately right is a shortfall figure that is wrong.

## Rules worth knowing before you change anything

**A stored balance is true *as of* its own day, and already includes that day.**
Integration runs forward from `balanceAsOf` and *backwards* from it for any part
of the window that precedes it, subtracting rather than adding. Two consequences
surprise people:

- A bill dated on an account's `balanceAsOf` is already inside that reading and
  is not charged again.
- A bill dated *before* it raises the earlier balances, correctly — the account
  had more money before it paid.

**A transfer is neutral on the combined line only once it post-dates every
reading involved.** Both legs come from one record, so they cancel — unless one
account's reading already includes the transfer and the other's does not, in
which case the combined line legitimately moves. `domain/projection.test.ts` has
that case worked out longhand. It is a fact about stale readings, not about
transfers.

**The verdict window and the chart window are different spans.** The dashboard
draws from two weeks back and judges from tomorrow; the shortfall screen judges
from today. `ProjectionWindow.verdictFrom` carries that, and the running minimum
is tracked only from it. A `verdictFrom` past the window's end leaves `lowest`
null, because there is genuinely no future in that window.

**Discretionary spending is divided by the length of the month it falls in**, not
amortized flat across the year, and the remainder is distributed so a month costs
exactly what the user said a month costs. See `domain/discretionary.ts` for why
the flat form was wrong in the one direction that matters.

**One walk, not two.** `project` produces the series, the running minimum and
the closing balance in the same pass. `evaluate` takes that summary rather than
a list of points precisely so that it *cannot* re-scan. If you find yourself
writing a loop over `points` to find a minimum, the engine already found it.

## Performance

The budget is **5 ms for a 90-day projection across 5 accounts**, because the
dashboard reprojects on every reactive change — an account toggled, a what-if
amount dragged, the horizon switched — and each has to land inside a frame with
the chart's own work still to do.

Recorded on an Apple-silicon laptop under Bun 1.3, median of 200 runs after
warm-up:

| Shape | Median | p95 |
|---|---|---|
| 90 days x 5 accounts | 0.117 ms | 0.134 ms |
| 730 days x 5 accounts | 0.716 ms | 0.763 ms |
| 90 days, narrowed to 1 account | 0.089 ms | 0.100 ms |

Roughly forty times the headroom, deliberately. `tests/domain/benchmark.test.ts`
asserts it, and asserts that eight times the window costs about six times the
work rather than sixty — the point is to catch a walk that stopped being linear,
not a 20% drift on a busy CI runner.

## How it is tested

| Suite | What it proves |
|---|---|
| `domain/*.test.ts` | the examples: cadence expansion, overrides, integration, the verdict bands |
| `domain/projection.properties.test.ts` | the four invariants, over generated portfolios (`fast-check`) |
| `domain/golden.test.ts` + `domain/fixtures/` | nine committed calendar edges, compared verbatim |
| `tests/domain/purity.test.ts` | no imports outside `domain/`, no clock, no logging |
| `tests/domain/benchmark.test.ts` | the budget above |

All of it runs with `bun run test:unit`. No database, no Docker, no Nuxt boot.
