/**
 * Occurrence-level edits — what the dashboard's day editor produces.
 *
 * An override is a change to a *materialized* occurrence, not to the recurring
 * item behind it, so it cannot be expressed by editing a `RecurringItem`: "this
 * Aug 20 car payment is $4,496" has no representation in a cadence plus an
 * amount. It is applied while the projection expands its occurrences, which is
 * why it lives in the domain rather than in the screen that collects it — the
 * chart, the verdict and the Upcoming list must all see the same edited event.
 *
 * The same shape carries saved edits and what-if previews; which list an
 * override lands in is the caller's business, and the engine treats both
 * identically.
 */

import type { IsoDate } from './dates'
import { compareDates } from './dates'
import type { MinorUnits } from './money'
import type { Occurrence } from './projection'

/**
 * `once` retimes and re-prices a single event; `future` rewrites the amount on
 * every occurrence of that item from `date` onward.
 */
export type OverrideScope = 'once' | 'future'

export interface OccurrenceOverride {
  readonly itemId: string
  /** The occurrence being edited, identified by the day it originally lands on. */
  readonly date: IsoDate
  readonly scope: OverrideScope
  /** Signed, matching `Occurrence.amount`: income positive, bills negative. */
  readonly amount: MinorUnits
  /**
   * `once` only — moves that single event to another day. Deliberately ignored
   * by `future`, which is an amount rule: retiming an unbounded series of
   * occurrences is not a thing a date field can express.
   */
  readonly newDate?: IsoDate
}

function applyOne(occurrence: Occurrence, override: OccurrenceOverride): Occurrence {
  if (occurrence.itemId !== override.itemId) return occurrence

  if (override.scope === 'future') {
    if (compareDates(occurrence.date, override.date) < 0) return occurrence
    return { ...occurrence, amount: override.amount }
  }

  if (occurrence.date !== override.date) return occurrence
  const date = override.newDate ?? occurrence.date
  // The id is composed from the item and the date, so a retimed occurrence has
  // to be re-keyed or two events would share one id.
  return { ...occurrence, amount: override.amount, date, id: `${occurrence.itemId}@${date}` }
}

/**
 * Rewrites `occurrences` under `overrides`, later overrides winning.
 *
 * Order matters and is the caller's: a what-if list appended after the saved
 * list previews on top of saved edits rather than beside them.
 */
export function applyOverrides(
  occurrences: readonly Occurrence[],
  overrides: readonly OccurrenceOverride[],
): Occurrence[] {
  if (overrides.length === 0) return [...occurrences]
  return occurrences.map((occurrence) =>
    overrides.reduce((current, override) => applyOne(current, override), occurrence),
  )
}

/**
 * Adds `override` to a list, replacing any earlier edit of the same occurrence.
 *
 * Editing one day twice is one override, not two: without this the second edit
 * would stack on a stale copy of the first and a retimed event could no longer
 * be found by its original date.
 */
export function withOverride(
  overrides: readonly OccurrenceOverride[],
  override: OccurrenceOverride,
): OccurrenceOverride[] {
  const kept = overrides.filter(
    (existing) =>
      existing.itemId !== override.itemId ||
      existing.date !== override.date ||
      existing.scope !== override.scope,
  )
  return [...kept, override]
}
