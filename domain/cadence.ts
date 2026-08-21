/**
 * Expanding a recurring item into the individual days it lands on.
 *
 * Expansion runs in **both** directions from the item's anchor
 * (`nextOccurrence`), because the dashboard's window opens two weeks before
 * today and those past occurrences are real events that already moved the
 * balance. Treating the anchor as a hard floor would silently flatten the
 * look-back portion of every chart.
 *
 * A cadence has two parts: a **cycle** and the **days within it**. The cycle
 * comes from `cadence` and the anchor — every week, every other week counted
 * from the anchor's week, every month, every twelfth month. The days come from
 * `daysOfMonth` / `daysOfWeek`, or, when those are absent, from the anchor
 * alone. That split is what lets one rule be semi-monthly (`[1, 15]`) without a
 * `semimonthly` cadence existing: the vocabulary stays at four values while the
 * arrangements stay open-ended. `recurring_rules` is shaped the same way.
 */

import type { IsoDate } from './dates'
import {
  addDays,
  addMonthsClamped,
  compareDates,
  dayOfMonth,
  daysBetween,
  isoWeekday,
  maxDate,
  minDate,
  monthIndex,
  startOfIsoWeek,
} from './dates'
import { LAST_DAY_OF_MONTH, type RecurringItem } from './types'

const STEP_DAYS: Record<'weekly' | 'biweekly', number> = { weekly: 7, biweekly: 14 }

/** No month has more than 31 days, so asking for the 31st and clamping *is* month end. */
const LAST_POSSIBLE_DAY_OF_MONTH = 31

/**
 * Ascending, with duplicates removed.
 *
 * Duplicates are not a hypothetical: clamping lands `[30, 31]` on the same date
 * in February, and one calendar day is one occurrence. The database agrees —
 * `occurrences` is unique on `(rule_id, projected_date)` — so emitting the pair
 * would produce a row that cannot be stored.
 */
function ascendingUnique(dates: IsoDate[]): IsoDate[] {
  // ISO dates are zero-padded and fixed-width, so lexical order is chronological.
  dates.sort()
  return dates.filter((date, index) => index === 0 || date !== dates[index - 1])
}

/**
 * Weekly and biweekly: a cycle of whole weeks, and the weekdays inside it.
 *
 * The cycle is counted from the Monday of the anchor's week rather than from
 * the anchor itself, so a biweekly rule anchored on a Thursday still emits the
 * Monday of that same fortnight when `daysOfWeek` asks for one.
 */
function weekAlignedDates(item: RecurringItem, start: IsoDate, end: IsoDate): IsoDate[] {
  const anchor = item.nextOccurrence
  const step = STEP_DAYS[item.cadence as 'weekly' | 'biweekly']
  const weekdays = item.daysOfWeek?.length ? item.daysOfWeek : [isoWeekday(anchor)]
  const baseWeek = startOfIsoWeek(anchor)

  // Computed, not estimated: every date in a cycle falls within the seven days
  // following its start, so one cycle of slack each side covers the boundary.
  const firstCycle = Math.floor(daysBetween(baseWeek, start) / step) - 1
  const lastCycle = Math.floor(daysBetween(baseWeek, end) / step) + 1

  const dates: IsoDate[] = []
  for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
    const cycleStart = addDays(baseWeek, cycle * step)
    for (const weekday of weekdays) {
      const date = addDays(cycleStart, weekday - 1)
      if (compareDates(date, start) >= 0 && compareDates(date, end) <= 0) dates.push(date)
    }
  }
  return dates
}

/**
 * Monthly and annual: a cycle of whole months, and the days inside it.
 *
 * Each date is built from the anchor and a day number, never from the previous
 * occurrence, which is what keeps a clamp from sticking — a rule on the 31st
 * lands on Feb 28 and then returns to the 31st in March.
 */
function monthAlignedDates(item: RecurringItem, start: IsoDate, end: IsoDate): IsoDate[] {
  const anchor = item.nextOccurrence
  const stepMonths = item.cadence === 'annual' ? 12 : 1
  const days =
    item.cadence === 'monthly' && item.daysOfMonth?.length ? item.daysOfMonth : [dayOfMonth(anchor)]

  const anchorMonth = monthIndex(anchor)
  const firstCycle = Math.floor((monthIndex(start) - anchorMonth) / stepMonths) - 1
  const lastCycle = Math.floor((monthIndex(end) - anchorMonth) / stepMonths) + 1

  const dates: IsoDate[] = []
  for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
    for (const day of days) {
      const date = addMonthsClamped(
        anchor,
        cycle * stepMonths,
        day === LAST_DAY_OF_MONTH ? LAST_POSSIBLE_DAY_OF_MONTH : day,
      )
      if (compareDates(date, start) >= 0 && compareDates(date, end) <= 0) dates.push(date)
    }
  }
  return dates
}

/**
 * Every date in `[start, end]` on which `item` occurs, ascending.
 *
 * Returns an empty array when `end` precedes `start`.
 */
export function occurrenceDates(item: RecurringItem, start: IsoDate, end: IsoDate): IsoDate[] {
  // The rule's own window is clamped in first: `startsOn`/`endsOn` bound where
  // the rule is even active, before the caller's requested range is applied.
  // This is what makes apply-to-future a rule split rather than a bulk edit —
  // the closed rule simply stops producing occurrences past its `endsOn`.
  const effectiveStart = maxDate(start, item.startsOn ?? start)
  const effectiveEnd = minDate(end, item.endsOn ?? end)
  if (compareDates(effectiveStart, effectiveEnd) > 0) return []

  const dates =
    item.cadence === 'weekly' || item.cadence === 'biweekly'
      ? weekAlignedDates(item, effectiveStart, effectiveEnd)
      : monthAlignedDates(item, effectiveStart, effectiveEnd)

  return ascendingUnique(dates)
}
