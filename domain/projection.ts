/**
 * The projection engine.
 *
 * Everything numeric that any Runway screen displays is computed here. No Vue
 * component performs financial arithmetic — components receive a `Projection`
 * and render it. All money is integer minor units throughout; there is not a
 * single floating-point monetary value in this module.
 */

import { occurrenceDates } from './cadence'
import { addDays, compareDates, daysBetween, eachDay, minDate } from './dates'
import type { IsoDate } from './dates'
import type { MinorUnits } from './money'
import type { Account, RecurringItem, RunwayData } from './types'

/** $250 of headroom above the cushion is the boundary between Covered and Tight. */
export const TIGHT_THRESHOLD: MinorUnits = 25_000

/** How far ahead the shortfall screen looks for selectable bills. */
export const UPCOMING_BILL_HORIZON_DAYS = 120

export interface Occurrence {
  /** Stable within one projection; composed of the item id and the date. */
  readonly id: string
  readonly itemId: string
  readonly date: IsoDate
  readonly label: string
  readonly accountId: string
  /** Signed: income is positive, bills negative. */
  readonly amount: MinorUnits
  readonly isVariable: boolean
  readonly isPredicted: boolean
}

export interface DayPoint {
  readonly date: IsoDate
  readonly balance: MinorUnits
}

export interface AccountSeries {
  readonly accountId: string
  readonly points: readonly DayPoint[]
}

export interface Projection {
  readonly days: readonly IsoDate[]
  readonly byAccount: readonly AccountSeries[]
  /** Sum across the accounts included in this projection, day by day. */
  readonly combined: readonly DayPoint[]
  readonly occurrences: readonly Occurrence[]
}

export interface ProjectionWindow {
  readonly start: IsoDate
  readonly end: IsoDate
  /** Limits the projection to these accounts. Omit for all of them. */
  readonly accountIds?: readonly string[]
}

/** The signed daily delta for one item's occurrence. */
function signedAmount(item: RecurringItem): MinorUnits {
  return item.kind === 'income' ? item.amount : -item.amount
}

function accountsFor(data: RunwayData, accountIds: readonly string[] | undefined): Account[] {
  if (!accountIds) return [...data.accounts]
  const wanted = new Set(accountIds)
  return data.accounts.filter((account) => wanted.has(account.id))
}

/**
 * Every occurrence landing in `[start, end]` for the given accounts, ascending
 * by date and then by label so same-day ordering is stable rather than
 * dependent on item insertion order.
 */
export function occurrencesIn(
  data: RunwayData,
  window: ProjectionWindow,
): Occurrence[] {
  const included = new Set(accountsFor(data, window.accountIds).map((account) => account.id))
  const occurrences: Occurrence[] = []

  for (const item of data.recurringItems) {
    if (!included.has(item.accountId)) continue
    for (const date of occurrenceDates(item, window.start, window.end)) {
      occurrences.push({
        id: `${item.id}@${date}`,
        itemId: item.id,
        date,
        label: item.name,
        accountId: item.accountId,
        amount: signedAmount(item),
        isVariable: item.kind === 'bill' && item.isVariable,
        isPredicted: item.kind === 'income' && item.amountSource === 'predicted',
      })
    }
  }

  occurrences.sort(
    (a, b) => compareDates(a.date, b.date) || a.label.localeCompare(b.label),
  )
  return occurrences
}

/**
 * Per-account, per-day balance deltas: recurring occurrences, both legs of
 * every transfer, and the flat discretionary drain.
 */
function buildDeltas(
  data: RunwayData,
  accounts: readonly Account[],
  days: readonly IsoDate[],
  occurrences: readonly Occurrence[],
): Map<string, Map<IsoDate, MinorUnits>> {
  const included = new Set(accounts.map((account) => account.id))
  const deltas = new Map<string, Map<IsoDate, MinorUnits>>()
  for (const account of accounts) deltas.set(account.id, new Map())

  const add = (accountId: string, date: IsoDate, amount: MinorUnits): void => {
    const perAccount = deltas.get(accountId)
    if (!perAccount) return
    perAccount.set(date, (perAccount.get(date) ?? 0) + amount)
  }

  for (const occurrence of occurrences) add(occurrence.accountId, occurrence.date, occurrence.amount)

  // A transfer is balance-neutral by construction: the two legs are equal and
  // opposite and are written from one record, so the combined series cannot
  // move even if only one side of the pair is in view.
  for (const transfer of data.transfers) {
    if (compareDates(transfer.date, days[0] ?? transfer.date) < 0) continue
    if (included.has(transfer.fromAccountId)) add(transfer.fromAccountId, transfer.date, -transfer.amount)
    if (included.has(transfer.toAccountId)) add(transfer.toAccountId, transfer.date, transfer.amount)
  }

  const source = accounts.find((account) => account.isDiscretionarySource)
  if (source && data.dailyDiscretionarySpend > 0) {
    for (const date of days) add(source.id, date, -data.dailyDiscretionarySpend)
  }

  return deltas
}

/**
 * Integrates one account's deltas outward from its as-of reading.
 *
 * The stored balance is true *on* `balanceAsOf` and already includes that day's
 * activity, so integration runs forward from that index and backward from it —
 * subtracting, not adding — for any part of the window that precedes it.
 */
function integrate(
  account: Account,
  days: readonly IsoDate[],
  deltas: Map<IsoDate, MinorUnits>,
): DayPoint[] {
  const points: DayPoint[] = days.map((date) => ({ date, balance: 0 }))
  if (days.length === 0) return points

  let anchorIndex = days.findIndex((date) => compareDates(date, account.balanceAsOf) >= 0)
  if (anchorIndex === -1) anchorIndex = days.length - 1

  const balances = new Array<MinorUnits>(days.length).fill(0)
  balances[anchorIndex] = account.balance

  for (let i = anchorIndex + 1; i < days.length; i++) {
    balances[i] = (balances[i - 1] ?? 0) + (deltas.get(days[i] as IsoDate) ?? 0)
  }
  for (let i = anchorIndex - 1; i >= 0; i--) {
    balances[i] = (balances[i + 1] ?? 0) - (deltas.get(days[i + 1] as IsoDate) ?? 0)
  }

  return days.map((date, i) => ({ date, balance: balances[i] ?? 0 }))
}

/** Builds the day-by-day balance series for a window. */
export function project(data: RunwayData, window: ProjectionWindow): Projection {
  const accounts = accountsFor(data, window.accountIds)
  const earliestAsOf = accounts.reduce<IsoDate>(
    (earliest, account) => minDate(earliest, account.balanceAsOf),
    window.start,
  )
  // Integration must begin at the earlier of the window and every as-of
  // reading, otherwise an account whose reading predates the window would be
  // anchored at the wrong day and the whole series would be offset.
  const seriesDays = eachDay(minDate(window.start, earliestAsOf), window.end)
  const occurrences = occurrencesIn(data, {
    start: seriesDays[0] ?? window.start,
    end: window.end,
    ...(window.accountIds ? { accountIds: window.accountIds } : {}),
  })
  const deltas = buildDeltas(data, accounts, seriesDays, occurrences)

  const fullSeries = accounts.map((account) => ({
    accountId: account.id,
    points: integrate(account, seriesDays, deltas.get(account.id) ?? new Map()),
  }))

  const days = eachDay(window.start, window.end)
  const visible = new Set(days)
  const byAccount: AccountSeries[] = fullSeries.map((series) => ({
    accountId: series.accountId,
    points: series.points.filter((point) => visible.has(point.date)),
  }))

  const combined: DayPoint[] = days.map((date, index) => ({
    date,
    balance: byAccount.reduce((total, series) => total + (series.points[index]?.balance ?? 0), 0),
  }))

  return {
    days,
    byAccount,
    combined,
    occurrences: occurrences.filter((occurrence) => visible.has(occurrence.date)),
  }
}

export interface LowestPoint {
  readonly date: IsoDate
  readonly balance: MinorUnits
}

/**
 * The lowest point of a series.
 *
 * `from` defaults to `1` because the dashboard's verdict is about what is
 * *coming*: today's balance is a fact the user can already see, so including it
 * would let a dip that has already happened masquerade as a forecast. Ties
 * resolve to the earliest date, which is the one the user needs to act on.
 */
export function findLowestPoint(
  points: readonly DayPoint[],
  options: { readonly from?: number } = {},
): LowestPoint | null {
  const from = options.from ?? 1
  let lowest: LowestPoint | null = null
  for (let i = from; i < points.length; i++) {
    const point = points[i]
    if (!point) continue
    if (!lowest || point.balance < lowest.balance) lowest = { date: point.date, balance: point.balance }
  }
  return lowest
}

export type RunwayStatus = 'covered' | 'tight' | 'short'

/**
 * The three-band dashboard verdict. `margin` is `lowest − cushion`.
 *
 * The $250 boundary between covered and tight is a product rule, not a
 * rendering detail, which is why it lives here and is tested here.
 */
export function classifyMargin(margin: MinorUnits): RunwayStatus {
  if (margin >= TIGHT_THRESHOLD) return 'covered'
  if (margin >= 0) return 'tight'
  return 'short'
}

export interface Verdict {
  readonly status: RunwayStatus
  readonly lowest: LowestPoint | null
  /** `lowest − cushion`. Negative means short by that much. */
  readonly margin: MinorUnits
  /** `true` for the shortfall screen's two-outcome question. */
  readonly isCovered: boolean
}

export function evaluate(
  points: readonly DayPoint[],
  cushion: MinorUnits,
  options: { readonly from?: number } = {},
): Verdict {
  const lowest = findLowestPoint(points, options)
  const margin = (lowest?.balance ?? 0) - cushion
  return { status: classifyMargin(margin), lowest, margin, isCovered: margin >= 0 }
}

export interface UpcomingBill {
  readonly itemId: string
  readonly label: string
  readonly date: IsoDate
  /** Signed (negative), matching the occurrence it came from. */
  readonly amount: MinorUnits
  readonly daysAway: number
}

/**
 * The bills offered as targets on the shortfall screen.
 *
 * Three product rules, each deliberate: bills only (a paycheck is not a
 * deadline), only the *next* occurrence of each item (six rows, not sixty), and
 * a 120-day horizon. All three are asserted in the tests.
 */
export function upcomingBills(
  data: RunwayData,
  today: IsoDate,
  horizonDays: number = UPCOMING_BILL_HORIZON_DAYS,
): UpcomingBill[] {
  const occurrences = occurrencesIn(data, {
    start: addDays(today, 1),
    end: addDays(today, horizonDays),
  })

  const seen = new Set<string>()
  const bills: UpcomingBill[] = []
  for (const occurrence of occurrences) {
    if (occurrence.amount >= 0) continue
    if (seen.has(occurrence.itemId)) continue
    seen.add(occurrence.itemId)
    bills.push({
      itemId: occurrence.itemId,
      label: occurrence.label,
      date: occurrence.date,
      amount: occurrence.amount,
      daysAway: daysBetween(today, occurrence.date),
    })
  }
  return bills
}
