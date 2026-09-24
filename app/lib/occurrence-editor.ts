/**
 * Pure copy builders and payload types for `DayDetailEditor.vue` (issue #15).
 *
 * No arithmetic on balances here — `splitConsequence` only ever formats
 * dates and an amount that arrived already resolved. Kept out of the
 * component so the copy is under unit test and date arithmetic stays out of
 * the template, matching `app/lib/shortfall-target.ts`'s own reasoning for
 * living outside its screen.
 */

import type { IsoDate } from '~~/domain/dates'
import { addDays } from '~~/domain/dates'
import type { MinorUnits } from '~~/domain/money'
import type { OverrideScope } from '~~/domain/overrides'
import type { Cadence } from '~~/domain/types'
import { formatDateShort, formatMoney } from './format'

/** The payload `DayDetailEditor.vue` emits on `save`. */
export interface OccurrenceEdit {
  readonly itemId: string
  /** The occurrence's projected date — the half of `occurrences`' natural key that never moves. */
  readonly date: IsoDate
  readonly scope: OverrideScope
  /** Signed, matching `Occurrence.amount`. */
  readonly amount: MinorUnits
  /** `once` only; omitted when the date is unchanged. */
  readonly newDate?: IsoDate
  /** The rule's own signed amount for this date, for the insert branch of `override_occurrence`. */
  readonly projectedAmount: MinorUnits
}

/** The payload `DayDetailEditor.vue` emits on `revert`. */
export interface OccurrenceRevert {
  readonly itemId: string
  readonly date: IsoDate
}

/** How often a rule repeats, worked into the consequence sentence below. */
const CADENCE_ADVERB: Record<Cadence, string> = {
  weekly: 'each week',
  biweekly: 'every two weeks',
  monthly: 'each month',
  annual: 'each year',
}

/**
 * The sentence shown under "Apply to all future" before it is pressed:
 * "Every Rent from Sep 1 becomes $1,750 each month. The current schedule
 * closes Aug 31; past occurrences are kept."
 *
 * States the consequence in words rather than leaving it as a silent
 * side effect of pressing a button — apply-to-future closes the existing
 * rule and opens a successor (docs/database/schema.md § "Rule splitting"),
 * and that is not guessable from a toggle alone.
 */
export function splitConsequence(input: {
  readonly label: string
  readonly cadence: Cadence
  readonly effectiveFrom: IsoDate
  readonly amount: MinorUnits
  /**
   * Issue #18: the rule is estimated (predicted income or a variable bill).
   * `split_recurring_rule` pins the new schedule to the amount given, so the
   * sentence has to say the estimate stops — it is not guessable otherwise.
   */
  readonly estimating?: boolean
}): string {
  const closesOn = addDays(input.effectiveFrom, -1)
  return (
    `Every ${input.label} from ${formatDateShort(input.effectiveFrom)} becomes ` +
    `${formatMoney(input.amount)} ${CADENCE_ADVERB[input.cadence]}. The current schedule closes ` +
    `${formatDateShort(closesOn)}; past occurrences are kept.` +
    (input.estimating ? ' From then on this is a fixed amount, no longer estimated.' : '')
  )
}

/**
 * The one-line summary shown for an already-overridden occurrence: "Rule
 * value: $310 on Aug 20." — what "Revert to rule value" restores.
 */
export function overrideSummary(input: {
  readonly projectedAmount: MinorUnits
  readonly projectedDate: IsoDate
}): string {
  return `Rule value: ${formatMoney(input.projectedAmount)} on ${formatDateShort(input.projectedDate)}`
}

/**
 * The identity of one occurrence, as a string a `Map` or `Set` can key on.
 *
 * `(itemId, projectedDate)` is `occurrences`' natural key and the only half of
 * an occurrence that survives a retime — the same pair `OccurrenceEdit.date`
 * and `OccurrenceRevert.date` carry, and deliberately not `Occurrence.id`,
 * which `applyOne` rewrites the moment an override lands on it. A row keyed on
 * `id` remounts on every edit; a row keyed on this one keeps its draft, its
 * focus and its place.
 */
export function occurrenceKey(itemId: string, date: IsoDate): string {
  return `${itemId}@${date}`
}
