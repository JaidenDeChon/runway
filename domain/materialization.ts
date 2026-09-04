/**
 * The desired set of materialized occurrences for a window.
 *
 * `public.occurrences` (issue #9) needs a `(rule_id, projected_date,
 * projected_amount_cents)` row for every date every rule lands on inside a
 * sliding window, so that the occurrence editor (#15), income prediction
 * (#18) and reconciliation (#26) all have real rows to work against instead
 * of re-expanding the rules themselves. This module computes that desired
 * set; it does not write anything — the RPC in
 * `supabase/migrations/<ts>_occurrence_regeneration.sql` applies it.
 *
 * `occurrenceDates` (`./cadence`) is the only correct expander. A pure-SQL
 * generator was considered and rejected: Postgres' `generate_series(d, ...,
 * interval '1 month')` is sticky (Jan 31 -> Feb 28 -> Mar 28) while
 * `addMonthsClamped` here is not (-> Mar 31) — `supabase/seed.sql` already
 * carries that scar. Re-implementing cadence expansion in SQL would silently
 * diverge from the engine a second time.
 */

import { occurrenceDates } from './cadence'
import type { IsoDate } from './dates'
import { addDays, compareDates } from './dates'
import type { MinorUnits } from './money'
import { signedAmount } from './projection'
import type { RecurringItem } from './types'

/** How many days of history a materialized window retains behind `today`. */
export const MATERIALIZATION_LOOKBACK_DAYS = 90

/** How far forward a materialized window extends ahead of `today`. */
export const MATERIALIZATION_HORIZON_DAYS = 365

export interface MaterializationWindow {
  readonly start: IsoDate
  readonly end: IsoDate
}

/**
 * The window materialization keeps rows for, `today - 90` to `today + 365`.
 *
 * Deliberately not `user_settings.default_horizon_days` — that column is a
 * fact about the dashboard's chart, not about storage (`docs/database/schema.md`,
 * "The horizon is not a menu"). A UI toggle must never resize what is stored.
 */
export function materializationWindow(today: IsoDate): MaterializationWindow {
  return {
    start: addDays(today, -MATERIALIZATION_LOOKBACK_DAYS),
    end: addDays(today, MATERIALIZATION_HORIZON_DAYS),
  }
}

export interface DesiredOccurrence {
  readonly ruleId: string
  readonly date: IsoDate
  /** Signed, matching `projection.ts` `signedAmount`: income positive, bills negative. */
  readonly amount: MinorUnits
}

/**
 * Every occurrence every one of `items` produces inside `window`, ascending by
 * rule id then date, de-duplicated on the pair.
 *
 * Deliberately does not filter by account state — a rule on an archived
 * account is still materialized (`docs/database/schema.md`, "Archiving, not
 * deleting"); excluding it here would make the RPC's guarded delete strip its
 * future rows the first time regeneration ran after the archive.
 */
export function desiredOccurrences(
  items: readonly RecurringItem[],
  window: MaterializationWindow,
): DesiredOccurrence[] {
  const seen = new Set<string>()
  const desired: DesiredOccurrence[] = []

  for (const item of items) {
    const amount = signedAmount(item)
    for (const date of occurrenceDates(item, window.start, window.end)) {
      const key = `${item.id}\0${date}`
      if (seen.has(key)) continue
      seen.add(key)
      desired.push({ ruleId: item.id, date, amount })
    }
  }

  desired.sort((a, b) => a.ruleId.localeCompare(b.ruleId) || compareDates(a.date, b.date))
  return desired
}
