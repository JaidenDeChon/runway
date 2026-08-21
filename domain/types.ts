/**
 * The Runway data model.
 *
 * Two rules hold everywhere in this file and are not negotiable:
 *
 * 1. **Money is integer minor units.** Every field typed `MinorUnits` is whole
 *    cents. Nothing in the domain or the app ever holds a monetary float;
 *    major units exist only at the input/display edge.
 * 2. **Dates are calendar days**, `YYYY-MM-DD`, never instants. See `dates.ts`.
 */

import type { IsoDate } from './dates'
import type { MinorUnits } from './money'

/**
 * The chart ramp slot an account's line is drawn in.
 *
 * Only three of the five ramp slots are assignable: `--chart-1` is reserved for
 * the combined burndown line and `--chart-5` for what-if tinting, so offering
 * either as an account color would collide with a line the user cannot move.
 */
export type AccountColor = 'chart-2' | 'chart-3' | 'chart-4'

export const ACCOUNT_COLORS: readonly AccountColor[] = ['chart-2', 'chart-3', 'chart-4'] as const

export interface Account {
  readonly id: string
  readonly name: string
  /** A point-in-time reading, true as of `balanceAsOf`. Projection runs forward from there. */
  readonly balance: MinorUnits
  readonly balanceAsOf: IsoDate
  readonly color: AccountColor
  /**
   * Whether daily discretionary spending drains this account.
   *
   * At most one account may hold this at a time; the invariant is enforced by
   * `setDiscretionarySource`, not by whichever screen happens to write it.
   */
  readonly isDiscretionarySource: boolean
}

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'annual'

/**
 * The cadences the recurring-item editor offers.
 *
 * Deliberately three, not four: `docs/design/recurring-items/spec.md` line 187
 * enumerates exactly Weekly / Biweekly / Monthly, so adding `annual` here is a
 * design decision, not a schema consequence. The schema and `occurrenceDates`
 * already support `annual` — see `domain/cadence.ts` — the picker just doesn't
 * offer it yet. The same is true of `daysOfMonth` / `daysOfWeek` below: an item
 * can be semi-monthly in the database and in the engine, but no screen offers a
 * way to say so until the recurring-items work lands.
 */
export const CADENCES: readonly Cadence[] = ['weekly', 'biweekly', 'monthly'] as const

/**
 * The `daysOfMonth` value meaning "the last day of whatever month this is".
 *
 * A month-end bill is a real, common thing, and `31` only means month-end in
 * seven months of the year. Storing the intent separately from the number keeps
 * "the 31st, clamped" distinguishable from "month end, whenever that falls".
 */
export const LAST_DAY_OF_MONTH = -1

export type RecurringKind = 'bill' | 'income'

/**
 * How an income item's amount is arrived at.
 *
 * `fixed` uses the typed amount. `predicted` derives it from `depositHistory`
 * — see `prediction.ts`. Bills are always `fixed`.
 */
export type AmountSource = 'fixed' | 'predicted'

/**
 * A bill or income rule, expanded into individual occurrences by
 * `occurrenceDates`.
 *
 * Apply-to-future is a **split**, never a bulk occurrence edit: close this
 * rule with `endsOn` and open a new rule from the change date forward via
 * `startsOn`. Bulk-updating occurrence rows loses history and breaks
 * reconciliation — see `docs/database/schema.md`.
 */
export interface RecurringItem {
  readonly id: string
  readonly name: string
  readonly kind: RecurringKind
  /**
   * Always a positive magnitude. The sign is derived from `kind` at projection
   * time, so a bill can never be accidentally stored as a positive delta.
   */
  readonly amount: MinorUnits
  readonly cadence: Cadence
  /**
   * Extra days of the month a `monthly` item lands on. Omitted — the usual
   * case — means the single day `nextOccurrence` falls on.
   *
   * `[1, 15]` is semi-monthly, which is how most paychecks arrive; any other
   * combination works the same way, and `LAST_DAY_OF_MONTH` (-1) means month
   * end. A day the month does not have clamps to that month's last day, so
   * `[30, 31]` produces one occurrence in February, not two.
   *
   * Ignored for every cadence but `monthly`.
   */
  readonly daysOfMonth?: readonly number[]
  /**
   * Extra weekdays a `weekly` or `biweekly` item lands on, ISO-numbered —
   * 1 = Monday through 7 = Sunday. Omitted means the weekday `nextOccurrence`
   * falls on.
   *
   * Biweekly still takes its phase from `nextOccurrence`: the week containing
   * it, then every other week.
   *
   * Ignored for every cadence but `weekly` and `biweekly`.
   */
  readonly daysOfWeek?: readonly number[]
  readonly accountId: string
  readonly nextOccurrence: IsoDate
  readonly amountSource: AmountSource
  /** Past deposits backing a `predicted` amount, oldest first. */
  readonly depositHistory: readonly MinorUnits[]
  /**
   * Bill-only: the amount changes each cycle (a utility bill). Purely a
   * presentation marker — the stored amount is still what projection uses.
   */
  readonly isVariable: boolean
  /** Inclusive window bound. `undefined` means unbounded in that direction. */
  readonly startsOn?: IsoDate
  /** Inclusive window bound. `undefined` means unbounded in that direction. */
  readonly endsOn?: IsoDate
}

/**
 * A move between two of the user's own accounts.
 *
 * Held as one record with two legs rather than two ledger entries, so the pair
 * can never drift apart or be edited independently. A transfer is
 * balance-neutral: it must never register as income or spending.
 */
export interface Transfer {
  readonly id: string
  readonly fromAccountId: string
  readonly toAccountId: string
  readonly amount: MinorUnits
  readonly date: IsoDate
  /** Tie-breaker for two transfers on the same calendar day. */
  readonly createdAt: number
}

/**
 * Everything the projection engine reads. Screens hold one of these and derive
 * every figure they show from it.
 */
export interface RunwayData {
  readonly accounts: readonly Account[]
  readonly recurringItems: readonly RecurringItem[]
  readonly transfers: readonly Transfer[]
  /** Flat per-day spend drawn from the discretionary-source account. */
  readonly dailyDiscretionarySpend: MinorUnits
  /** The lowest balance the user is willing to see. Drives the covered/short verdict. */
  readonly safetyCushion: MinorUnits
}
