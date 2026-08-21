/**
 * The projection engine.
 *
 * Everything numeric that any Runway screen displays is computed here. No Vue
 * component performs financial arithmetic — components receive a `Projection`
 * and render it. All money is integer minor units throughout; there is not a
 * single floating-point monetary value in this module.
 */

import { occurrenceDates } from './cadence'
import type { IsoDate } from './dates'
import { addDays, compareDates, daysBetween, eachDay, maxDate, minDate } from './dates'
import { dailyDiscretionary } from './discretionary'
import type { MinorUnits } from './money'
import type { OccurrenceOverride } from './overrides'
import { applyOverrides } from './overrides'
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

export interface LowestPoint {
  readonly date: IsoDate
  readonly balance: MinorUnits
}

/**
 * What a caller asks a balance series for, produced by the same walk that
 * produced the series itself.
 *
 * The issue is explicit that the series and the shortfall must not be computed
 * twice, and this is how that holds: the running minimum and the endpoint fall
 * out of the one pass that accumulates the balances. Nothing re-scans a series
 * afterwards to find its low point, and no screen may either.
 */
export interface SeriesSummary {
  /**
   * The lowest balance at or after the window's `verdictFrom`, earliest date
   * winning a tie — that is the day the user still has time to act on.
   *
   * `null` only when `verdictFrom` falls past the end of the window, i.e. there
   * is no future left in this projection to have a low point in.
   */
  readonly lowest: LowestPoint | null
  /** The balance on the window's last day. */
  readonly ending: MinorUnits
}

export interface AccountSeries {
  readonly accountId: string
  readonly points: readonly DayPoint[]
  readonly summary: SeriesSummary
}

export interface Projection {
  readonly days: readonly IsoDate[]
  readonly byAccount: readonly AccountSeries[]
  /** Sum across the accounts included in this projection, day by day. */
  readonly combined: readonly DayPoint[]
  /** The combined line's low point and endpoint, from the walk that built it. */
  readonly combinedSummary: SeriesSummary
  readonly occurrences: readonly Occurrence[]
  /** The first day the summaries consider. Resolved, never `undefined`. */
  readonly verdictFrom: IsoDate
}

export interface ProjectionWindow {
  readonly start: IsoDate
  readonly end: IsoDate
  /** Limits the projection to these accounts. Omit for all of them. */
  readonly accountIds?: readonly string[]
  /**
   * Occurrence-level edits to apply while expanding, later ones winning.
   *
   * The dashboard passes its saved edits and its what-if previews through here
   * rather than mutating stored data, so a preview is a different *window* onto
   * the same records and can be dropped by simply not passing it again.
   */
  readonly overrides?: readonly OccurrenceOverride[]
  /**
   * The first day the running minimum is allowed to consider. Defaults to
   * `start`.
   *
   * The dashboard charts a window that opens two weeks *before* today but must
   * judge only what is coming — a dip the user has already lived through is
   * history, not a forecast. The chart window and the verdict window are
   * therefore different spans, and the window carries both rather than the
   * screen re-scanning the series with an offset.
   *
   * Raised to `start` if it precedes it. A `verdictFrom` past `end` leaves every
   * summary's `lowest` null rather than throwing — there is genuinely no future
   * in that window to have a low point in.
   */
  readonly verdictFrom?: IsoDate
}

/**
 * The signed daily delta for one item's occurrence.
 *
 * Exported so screens that list items directly (recurring-items) can render
 * the same sign the projection engine uses, instead of re-deriving it from
 * `kind` inline in a component.
 */
export function signedAmount(item: RecurringItem): MinorUnits {
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
export function occurrencesIn(data: RunwayData, window: ProjectionWindow): Occurrence[] {
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

  // Overrides land before the sort because one of them can retime an event,
  // and a list sorted on the pre-edit dates would be out of order afterwards.
  const applied = window.overrides?.length
    ? applyOverrides(occurrences, window.overrides)
    : occurrences

  applied.sort((a, b) => compareDates(a.date, b.date) || a.label.localeCompare(b.label))
  return applied
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

  for (const occurrence of occurrences)
    add(occurrence.accountId, occurrence.date, occurrence.amount)

  // A transfer is balance-neutral by construction: the two legs are equal and
  // opposite and are written from one record, so the combined series cannot
  // move even if only one side of the pair is in view.
  for (const transfer of data.transfers) {
    if (compareDates(transfer.date, days[0] ?? transfer.date) < 0) continue
    if (included.has(transfer.fromAccountId))
      add(transfer.fromAccountId, transfer.date, -transfer.amount)
    if (included.has(transfer.toAccountId))
      add(transfer.toAccountId, transfer.date, transfer.amount)
  }

  // Divided by the length of the month each day falls in, so a month costs
  // exactly what the user said it costs — see `domain/discretionary.ts`.
  const source = accounts.find((account) => account.isDiscretionarySource)
  if (source && data.monthlyDiscretionarySpend > 0) {
    for (const date of days)
      add(source.id, date, -dailyDiscretionary(data.monthlyDiscretionarySpend, date))
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
): MinorUnits[] {
  const balances = new Array<MinorUnits>(days.length).fill(0)
  if (days.length === 0) return balances

  let anchorIndex = days.findIndex((date) => compareDates(date, account.balanceAsOf) >= 0)
  if (anchorIndex === -1) anchorIndex = days.length - 1
  balances[anchorIndex] = account.balance

  for (let i = anchorIndex + 1; i < days.length; i++) {
    balances[i] = (balances[i - 1] ?? 0) + (deltas.get(days[i] as IsoDate) ?? 0)
  }
  for (let i = anchorIndex - 1; i >= 0; i--) {
    balances[i] = (balances[i + 1] ?? 0) - (deltas.get(days[i + 1] as IsoDate) ?? 0)
  }

  return balances
}

/**
 * Builds the day-by-day balance series for a window, per account and combined,
 * along with each line's low point and closing balance.
 *
 * Everything a screen needs comes out of this one call. See
 * `docs/projection-engine.md` for worked examples.
 */
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
    ...(window.overrides ? { overrides: window.overrides } : {}),
  })
  const deltas = buildDeltas(data, accounts, seriesDays, occurrences)

  const days = eachDay(window.start, window.end)
  // Where the visible window begins inside the (possibly earlier-starting)
  // integration range. Both ranges end on the same day.
  const offset = Math.max(0, seriesDays.length - days.length)
  // Raised to the window's start if it precedes it — judging days the caller
  // did not ask to see is never what was meant — but deliberately *not* lowered
  // to `end`: a verdictFrom past the end means there is no future left in this
  // window, and that has to stay distinguishable from judging its last day.
  const requestedFrom = window.verdictFrom ?? window.start
  const verdictFrom = compareDates(requestedFrom, window.start) < 0 ? window.start : requestedFrom
  // Days before this index are drawn but not judged. `days.length` when the
  // window has no future in it at all, which leaves every `lowest` null.
  const verdictIndex =
    compareDates(verdictFrom, window.end) > 0
      ? days.length
      : Math.max(0, daysBetween(window.start, verdictFrom))

  // One pass per account: it slices the visible span out of the integration
  // range, accumulates the combined line as it goes, and tracks that account's
  // own low point and closing balance. No series is walked a second time.
  const combinedBalances = new Array<MinorUnits>(days.length).fill(0)
  const byAccount: AccountSeries[] = accounts.map((account) => {
    const balances = integrate(account, seriesDays, deltas.get(account.id) ?? new Map())
    const points: DayPoint[] = []
    let lowest: LowestPoint | null = null
    for (let i = 0; i < days.length; i++) {
      const date = days[i] as IsoDate
      const balance = balances[offset + i] ?? 0
      points.push({ date, balance })
      combinedBalances[i] = (combinedBalances[i] ?? 0) + balance
      // Strictly less-than, so an equal balance later in the window does not
      // displace the earliest day the user could act on.
      if (i >= verdictIndex && (!lowest || balance < lowest.balance)) lowest = { date, balance }
    }
    const ending = points.at(-1)?.balance ?? 0
    return { accountId: account.id, points, summary: { lowest, ending } }
  })

  // The combined low point is not derivable from the per-account low points —
  // two accounts can bottom out on different days — so it is tracked here, in
  // the single walk that turns the accumulated sums into points.
  const combined: DayPoint[] = []
  let combinedLowest: LowestPoint | null = null
  for (let i = 0; i < days.length; i++) {
    const date = days[i] as IsoDate
    const balance = combinedBalances[i] ?? 0
    combined.push({ date, balance })
    if (i >= verdictIndex && (!combinedLowest || balance < combinedLowest.balance))
      combinedLowest = { date, balance }
  }

  const visible = new Set(days)
  return {
    days,
    byAccount,
    combined,
    combinedSummary: { lowest: combinedLowest, ending: combined.at(-1)?.balance ?? 0 },
    occurrences: occurrences.filter((occurrence) => visible.has(occurrence.date)),
    verdictFrom,
  }
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
  /**
   * How far the low point falls below the cushion, as a positive magnitude;
   * `0` when covered.
   *
   * `Short by $1,404` is a figure, so it is computed here rather than by a
   * component flipping the sign of `margin` on its way into a formatter.
   */
  readonly shortfall: MinorUnits
}

/**
 * The verdict a summary implies against a cushion.
 *
 * Takes the summary rather than the series precisely so that it cannot walk
 * anything: the low point was already found, once, by `project`.
 */
export function evaluate(summary: SeriesSummary, cushion: MinorUnits): Verdict {
  const lowest = summary.lowest
  const margin = (lowest?.balance ?? 0) - cushion
  return {
    status: classifyMargin(margin),
    lowest,
    margin,
    isCovered: margin >= 0,
    shortfall: margin < 0 ? -margin : 0,
  }
}

export interface ShortfallQuestion {
  /** The day the window opens on, and the first day the cushion has to hold. */
  readonly today: IsoDate
  /**
   * The day being asked about — a bill's due date, or a date the user picked.
   *
   * Raised to `today` if it precedes it, so a stale selection asks a
   * degenerate question ("does the cushion hold today?") rather than an
   * inverted one.
   */
  readonly through: IsoDate
  /** The balance the user is unwilling to drop below. */
  readonly cushion: MinorUnits
  /** Limits the question to these accounts. Omit for all of them. */
  readonly accountIds?: readonly string[]
  readonly overrides?: readonly OccurrenceOverride[]
}

export interface ShortfallAnswer extends Verdict {
  /** The target the answer is about, after the raise-to-today rule above. */
  readonly through: IsoDate
  /** The combined balance on `today` — the figure the screen shows beside it. */
  readonly startingBalance: MinorUnits
  /** The combined balance on `through`. */
  readonly endingBalance: MinorUnits
}

/**
 * Whether the cushion survives to a given day, and by how much it misses.
 *
 * The shortfall is what it takes to hold the **running minimum** at or above
 * the cushion for every day in `[today, through]` — not what it takes to end
 * the window above it. Those are different numbers whenever a bill lands before
 * the paycheck that covers it, which is the exact situation this screen exists
 * for: a window can close $2,000 up and still bounce a payment in the middle.
 * Reading the endpoint alone would answer "yes, you make it" on a window the
 * user does not make it through.
 *
 * ```ts
 * const answer = shortfallThrough(data, { today, through: rent.date, cushion })
 * answer.isCovered  // false
 * answer.shortfall  // 140_400 — $1,404 short, on answer.lowest.date
 * ```
 *
 * This walks the projection once, through `project`. There is no second scan
 * and no separate shortfall arithmetic: the number comes from the same summary
 * the dashboard's verdict reads.
 */
export function shortfallThrough(data: RunwayData, question: ShortfallQuestion): ShortfallAnswer {
  const through = maxDate(question.today, question.through)
  const projection = project(data, {
    start: question.today,
    end: through,
    // Explicit rather than defaulted: this screen's promise is about the whole
    // span *including* today, unlike the dashboard's forward-looking verdict.
    verdictFrom: question.today,
    ...(question.accountIds ? { accountIds: question.accountIds } : {}),
    ...(question.overrides ? { overrides: question.overrides } : {}),
  })
  return {
    ...evaluate(projection.combinedSummary, question.cushion),
    through,
    startingBalance: projection.combined[0]?.balance ?? 0,
    endingBalance: projection.combinedSummary.ending,
  }
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
