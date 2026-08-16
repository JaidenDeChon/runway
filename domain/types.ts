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

export type Cadence = 'weekly' | 'biweekly' | 'monthly'

export const CADENCES: readonly Cadence[] = ['weekly', 'biweekly', 'monthly'] as const

export type RecurringKind = 'bill' | 'income'

/**
 * How an income item's amount is arrived at.
 *
 * `fixed` uses the typed amount. `predicted` derives it from `depositHistory`
 * — see `prediction.ts`. Bills are always `fixed`.
 */
export type AmountSource = 'fixed' | 'predicted'

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
