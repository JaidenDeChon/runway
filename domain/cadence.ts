/**
 * Expanding a recurring item into the individual days it lands on.
 *
 * Expansion runs in **both** directions from the item's anchor
 * (`nextOccurrence`), because the dashboard's window opens two weeks before
 * today and those past occurrences are real events that already moved the
 * balance. Treating the anchor as a hard floor would silently flatten the
 * look-back portion of every chart.
 */

import type { IsoDate } from './dates'
import {
  addDays,
  addMonthsClamped,
  compareDates,
  dayOfMonth,
  daysBetween,
  maxDate,
  minDate,
} from './dates'
import type { Cadence, RecurringItem } from './types'

const STEP_DAYS: Record<'weekly' | 'biweekly', number> = { weekly: 7, biweekly: 14 }

/** The nth occurrence relative to the anchor. `n` may be negative. */
function occurrenceAt(anchor: IsoDate, cadence: Cadence, anchorDay: number, n: number): IsoDate {
  if (cadence === 'monthly') return addMonthsClamped(anchor, n, anchorDay)
  // `addMonthsClamped(anchor, n * 12, anchorDay)` gets Feb-29 → Feb-28 clamping
  // for free, the same way the monthly path does.
  if (cadence === 'annual') return addMonthsClamped(anchor, n * 12, anchorDay)
  return addDays(anchor, n * STEP_DAYS[cadence])
}

/**
 * A starting index at or before the first occurrence in range.
 *
 * Stepping one at a time from the anchor would be unbounded when the anchor is
 * years from the window, so this jumps to an estimate and lets the caller walk
 * the last step or two. It must under-shoot — never over-shoot — or occurrences
 * inside the window get skipped, so it divides by the *longest* a step can be
 * (31 days for a month). Dividing by the shortest inflates the index instead,
 * which for a far-past anchor lands beyond the window and returns nothing.
 */
function estimateStartIndex(anchor: IsoDate, cadence: Cadence, start: IsoDate): number {
  const offset = daysBetween(anchor, start)
  const longestStep = cadence === 'monthly' ? 31 : cadence === 'annual' ? 366 : STEP_DAYS[cadence]
  return Math.floor(offset / longestStep) - 2
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

  const anchor = item.nextOccurrence
  const anchorDay = dayOfMonth(anchor)
  const dates: IsoDate[] = []

  let n = estimateStartIndex(anchor, item.cadence, effectiveStart)
  // A finite guard rather than `while (true)`: the window is bounded and each
  // step advances at least 7 days, so this can only be hit by a corrupt anchor.
  // The slack absorbs the deliberate under-shoot in the start estimate.
  const maxSteps = Math.ceil(daysBetween(effectiveStart, effectiveEnd) / 7) + 8
  for (let step = 0; step <= maxSteps; step++, n++) {
    const date = occurrenceAt(anchor, item.cadence, anchorDay, n)
    if (compareDates(date, effectiveEnd) > 0) break
    if (compareDates(date, effectiveStart) >= 0) dates.push(date)
  }
  return dates
}
