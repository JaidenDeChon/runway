/**
 * The golden scenarios: named inputs whose exact output is committed.
 *
 * Each one is a calendar edge that has historically broken projection code
 * somewhere — a month that ends on the 28th, a leap day, a clock that skips an
 * hour, two events on one day, a window where nothing happens at all. The
 * expected output lives in `golden.json` and is compared verbatim, so a change
 * anywhere in the engine that moves any of these numbers shows up as a diff
 * somebody has to look at and agree with.
 *
 * The scenarios are here, in the domain, rather than in a test file, because
 * both the test and the regeneration script need them and neither should own
 * them. Everything in this module is pure; see `fixtures/README.md`.
 */

import { addDays, type IsoDate } from '../dates'
import type { ProjectionWindow } from '../projection'
import { project } from '../projection'
import { createShortSeedData, SEED_TODAY } from '../seed'
import type { Account, RecurringItem, RunwayData, Transfer } from '../types'

export interface GoldenScenario {
  readonly name: string
  /** What edge this pins down. Reproduced into the golden file. */
  readonly why: string
  readonly data: RunwayData
  readonly window: ProjectionWindow
}

/** One account's line, reduced to the two figures a screen ever shows. */
export interface GoldenSeries {
  readonly accountId: string
  readonly ending: number
  readonly lowest: { readonly date: IsoDate; readonly balance: number } | null
}

export interface GoldenRecord {
  readonly name: string
  readonly why: string
  readonly window: { readonly start: IsoDate; readonly end: IsoDate; readonly days: number }
  /** `date label amount`, in the engine's own order. */
  readonly occurrences: readonly string[]
  readonly combined: readonly number[]
  readonly combinedLowest: { readonly date: IsoDate; readonly balance: number } | null
  readonly combinedEnding: number
  readonly byAccount: readonly GoldenSeries[]
}

const account = (over: Partial<Account> & Pick<Account, 'id' | 'balanceAsOf'>): Account => ({
  name: over.id,
  balance: 250_000,
  color: 'chart-2',
  isDiscretionarySource: false,
  ...over,
})

const rule = (over: Partial<RecurringItem> & Pick<RecurringItem, 'id' | 'nextOccurrence'>) => ({
  name: over.id,
  kind: 'bill' as const,
  amount: 50_000,
  cadence: 'monthly' as const,
  accountId: 'checking',
  amountSource: 'fixed' as const,
  depositHistory: [],
  isVariable: false,
  ...over,
})

const data = (over: Partial<RunwayData>): RunwayData => ({
  accounts: [],
  recurringItems: [],
  transfers: [],
  monthlyDiscretionarySpend: 0,
  safetyCushion: 60_000,
  timeZone: null,
  ...over,
})

/** A rule that fires on exactly one day: a monthly cadence with a one-day window. */
const once = (id: string, date: IsoDate, over: Partial<RecurringItem> = {}): RecurringItem =>
  rule({ id, nextOccurrence: date, startsOn: date, endsOn: date, ...over })

const monthEndBill = data({
  accounts: [account({ id: 'checking', balanceAsOf: '2026-01-30', balance: 900_000 })],
  recurringItems: [rule({ id: 'Rent', nextOccurrence: '2026-01-31', amount: 180_000 })],
})

const twentyNinth = (asOf: IsoDate, anchor: IsoDate): RunwayData =>
  data({
    accounts: [account({ id: 'checking', balanceAsOf: asOf, balance: 500_000 })],
    recurringItems: [rule({ id: 'Insurance', nextOccurrence: anchor, amount: 12_345 })],
  })

const dailyDrain = (asOf: IsoDate): RunwayData =>
  data({
    accounts: [
      account({ id: 'checking', balanceAsOf: asOf, balance: 400_000, isDiscretionarySource: true }),
    ],
    monthlyDiscretionarySpend: 100_000,
  })

/**
 * A reading two weeks before the window, with a bill, income and a discretionary
 * drain in between — the span the engine integrates across but nobody sees.
 */
const staleReading = data({
  accounts: [
    account({
      id: 'checking',
      balanceAsOf: '2026-05-01',
      balance: 500_000,
      isDiscretionarySource: true,
    }),
  ],
  recurringItems: [
    once('Rent', '2026-05-05', { amount: 120_000 }),
    once('Paycheck', '2026-05-10', { kind: 'income', amount: 300_000 }),
    once('Card', '2026-05-18', { amount: 40_000 }),
  ],
  monthlyDiscretionarySpend: 100_000,
})

const fiveAccounts: readonly Account[] = ['checking', 'savings', 'bills', 'travel', 'buffer'].map(
  (id, index) =>
    account({
      id,
      balanceAsOf: '2026-01-01',
      balance: 200_000 + index * 75_000,
      isDiscretionarySource: index === 0,
    }),
)

const fiveAccountItems: readonly RecurringItem[] = [
  rule({ id: 'Rent', nextOccurrence: '2026-01-01', amount: 180_000, daysOfMonth: [1] }),
  rule({ id: 'Utilities', nextOccurrence: '2026-01-12', amount: 14_500, accountId: 'bills' }),
  rule({ id: 'Card', nextOccurrence: '2026-01-20', amount: 62_000, accountId: 'bills' }),
  rule({
    id: 'Paycheck',
    nextOccurrence: '2026-01-09',
    kind: 'income',
    amount: 310_000,
    cadence: 'biweekly',
  }),
  rule({ id: 'Streaming', nextOccurrence: '2026-01-04', amount: 1_899, accountId: 'travel' }),
  rule({ id: 'Gym', nextOccurrence: '2026-01-06', amount: 4_500, cadence: 'weekly' }),
  rule({ id: 'Premium', nextOccurrence: '2026-02-14', amount: 89_900, cadence: 'annual' }),
]

const fiveAccountTransfers: readonly Transfer[] = [
  {
    id: 'x1',
    fromAccountId: 'checking',
    toAccountId: 'savings',
    amount: 50_000,
    date: '2026-01-15',
    createdAt: 1,
  },
  {
    id: 'x2',
    fromAccountId: 'savings',
    toAccountId: 'buffer',
    amount: 25_000,
    date: '2026-02-20',
    createdAt: 2,
  },
]

export const GOLDEN_SCENARIOS: readonly GoldenScenario[] = [
  {
    name: 'month-boundary-clamp',
    why: 'A month-end bill lands on Feb 28 and then returns to Mar 31. The clamp must not stick.',
    data: monthEndBill,
    window: { start: '2026-01-30', end: '2026-04-01' },
  },
  {
    name: 'leap-day-present',
    why: 'A rule on the 29th finds a 29th in February 2024 and lands on it.',
    data: twentyNinth('2024-02-26', '2024-01-29'),
    window: { start: '2024-02-26', end: '2024-03-02' },
  },
  {
    name: 'leap-day-absent',
    why: 'The same rule in 2026 has no 29th to land on and clamps to Feb 28.',
    data: twentyNinth('2026-02-26', '2026-01-29'),
    window: { start: '2026-02-26', end: '2026-03-02' },
  },
  {
    name: 'dst-spring-forward',
    why: 'Spans the US (Mar 8) and EU (Mar 29) spring transitions. Every day is one day.',
    data: dailyDrain('2026-03-06'),
    window: { start: '2026-03-06', end: '2026-03-31' },
  },
  {
    name: 'dst-fall-back',
    why: 'Spans the EU (Oct 25) and US (Nov 1) autumn transitions, and a month boundary with them.',
    data: dailyDrain('2026-10-23'),
    window: { start: '2026-10-23', end: '2026-11-03' },
  },
  {
    name: 'bill-and-income-same-day',
    why: 'Both land on 2026-02-10. The day nets out, and same-day order is by label, not by input order.',
    data: data({
      accounts: [account({ id: 'checking', balanceAsOf: '2026-02-08', balance: 120_000 })],
      recurringItems: [
        once('Rent', '2026-02-10', { amount: 180_000 }),
        once('Paycheck', '2026-02-10', { kind: 'income', amount: 310_000 }),
      ],
    }),
    window: { start: '2026-02-08', end: '2026-02-12' },
  },
  {
    name: 'empty-window',
    why: 'Accounts but no events at all. The line is flat and there is nothing to special-case.',
    data: data({
      accounts: [
        account({ id: 'checking', balanceAsOf: '2026-05-01', balance: 314_159 }),
        account({ id: 'savings', balanceAsOf: '2026-05-01', balance: 1_000_000 }),
      ],
    }),
    window: { start: '2026-05-01', end: '2026-05-10' },
  },
  {
    name: 'no-accounts',
    why: 'Nothing at all. Every series is empty and the combined line is a flat zero, not a crash.',
    data: data({}),
    window: { start: '2026-05-01', end: '2026-05-05' },
  },
  {
    name: 'stale-reading-with-events',
    why: 'A reading two weeks before the window, with a bill, income and a daily drain between the two. Every one of those has to be integrated across even though none of them is drawn.',
    data: staleReading,
    window: { start: '2026-05-15', end: '2026-05-20' },
  },
  {
    name: 'short-household',
    why: "The seeded short household over the dashboard's own window. It is the only fixture whose verdict is Short, and every figure the Short state prints — the low point, its date, the closing balance above it — is pinned here so a change to the engine has to move them in a diff somebody reads.",
    data: createShortSeedData(),
    window: {
      start: addDays(SEED_TODAY, -14),
      end: addDays(SEED_TODAY, 30),
      verdictFrom: addDays(SEED_TODAY, 1),
    },
  },
  {
    name: 'ninety-days-five-accounts',
    why: 'The performance scenario, pinned as a golden too so the benchmark cannot drift silently.',
    data: data({
      accounts: [...fiveAccounts],
      recurringItems: [...fiveAccountItems],
      transfers: [...fiveAccountTransfers],
      monthlyDiscretionarySpend: 103_400,
    }),
    window: { start: '2026-01-01', end: '2026-03-31', verdictFrom: '2026-01-02' },
  },
]

/** Projects a scenario and reduces it to the shape `golden.json` stores. */
export function snapshot(scenario: GoldenScenario): GoldenRecord {
  const projection = project(scenario.data, scenario.window)
  return {
    name: scenario.name,
    why: scenario.why,
    window: {
      start: scenario.window.start,
      end: scenario.window.end,
      days: projection.days.length,
    },
    occurrences: projection.occurrences.map(
      (occurrence) => `${occurrence.date} ${occurrence.label} ${occurrence.amount}`,
    ),
    combined: projection.combined.map((point) => point.balance),
    combinedLowest: projection.combinedSummary.lowest,
    combinedEnding: projection.combinedSummary.ending,
    byAccount: projection.byAccount.map((series) => ({
      accountId: series.accountId,
      ending: series.summary.ending,
      lowest: series.summary.lowest,
    })),
  }
}
